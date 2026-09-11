import { NextResponse } from "next/server";
import { readStorageConfig } from "@/storage/config";
import { resolveBlobTierForViewer } from "@/storage/server/blob-access";
import { streamBlobObject } from "@/storage/server/blob-api";
import { verifyBlobViewToken } from "@/storage/server/blob-view-token";
import { formatErrorForResponse } from "@/lib/format-error";

export const runtime = "nodejs";

/** Authenticated, time-limited blob read — avoids public R2 presigned URLs in the browser. */
export async function GET(request: Request) {
  if (readStorageConfig().provider !== "tiered") {
    return NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("t");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  let payload;
  try {
    payload = verifyBlobViewToken(token);
  } catch (err) {
    // Our own token verification — a configuration error (a missing secret),
    // which the formatter passes through because it is the operator's to fix.
    const message = formatErrorForResponse(err, "blobs-content");
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (!payload) return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });

  const dbTier = await resolveBlobTierForViewer(payload.bucket, payload.path, payload.uid);
  if (!dbTier) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const tier = dbTier;

  try {
    const object = await streamBlobObject(tier, payload.bucket, payload.path);
    if (!object) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return new NextResponse(object.stream, {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "private, no-store",
        // An uploaded SVG or HTML would otherwise run as this origin's script.
        // Sandboxed and script-less, it can still be shown in an <img>.
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    // An object-store failure, which can name a bucket or a key.
    const message = formatErrorForResponse(err, "blobs-content");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
