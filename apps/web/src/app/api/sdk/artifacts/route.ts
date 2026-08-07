import { NextResponse } from "next/server";
import { requireSdkUser } from "../_shared";
import {
  MAX_BODY_BYTES,
  exceedsDeclaredLimit,
  parseArtifactRequest,
} from "./artifact-request";

const BUCKET = "experiment-artifacts";
const EXPIRES_IN = 10 * 365 * 24 * 3600;

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

  const { data: signed, error: signErr } = await bucket.createSignedUrl(path, EXPIRES_IN);
  if (signErr) return NextResponse.json({ error: signErr.message }, { status: 500 });
  return NextResponse.json({ url: signed?.signedUrl ?? path, path });
}
