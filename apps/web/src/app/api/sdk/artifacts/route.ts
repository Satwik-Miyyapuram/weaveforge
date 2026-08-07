import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";
import {
  MAX_BODY_BYTES,
  exceedsDeclaredLimit,
  parseArtifactRequest,
} from "./artifact-request";

const BUCKET = "experiment-artifacts";

/**
 * Upload an experiment artifact from the Python SDK.
 *
 * The only unbounded write into our storage, so it is bounded here: an
 * oversized body is refused on its declared length before it is read, and the
 * decoded size is checked again because a declared length is a claim. Path
 * segments are validated too — the key is `{userId}/{experimentId}/{name}`, and
 * a name carrying a slash would write outside the caller's own folder.
 */
export async function POST(request: Request) {
  const user = await requireSdkUser(request);
  if (!user.ok) return user.response;

  // Before `json()`, which buffers whatever arrives.
  if (exceedsDeclaredLimit(request.headers.get("content-length"))) {
    return NextResponse.json(
      { error: `Request body exceeds ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseArtifactRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const path = `${user.userId}/${parsed.experimentId}/${parsed.name}`;
  const bucket = user.db.storage.from(BUCKET);
  const { error: upErr } = await bucket.upload(path, parsed.bytes, {
    contentType: parsed.contentType,
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Return the path, not a signed URL.
  //
  // This used to sign for ten years and hand that back, and the SDK stored the
  // result in `experiments.artifacts` as though it were a permanent address.
  // SigV4 caps a presigned URL at seven days and R2 enforces the cap silently:
  // the ten-year request did not fail, it was clamped. Every artifact link died
  // a week after upload, and the row kept pointing at it — so the figure showed
  // R2's `<Code>ExpiredRequest</Code>` XML instead of an image, with nothing in
  // the app to say why.
  //
  // A path has no expiry. The reader mints a short-lived URL when it actually
  // needs one, which is what paper images already do.
  return NextResponse.json({ path, url: path });
}
