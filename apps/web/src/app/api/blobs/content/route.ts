import { NextResponse } from "next/server";
import { readStorageConfig } from "@/storage/config";
import { resolveBlobTierForViewer } from "@/storage/server/blob-access";
import { streamBlobObject } from "@/storage/server/blob-api";
import { verifyBlobViewToken } from "@/storage/server/blob-view-token";

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
    const message = err instanceof Error ? err.message : String(err);
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
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
