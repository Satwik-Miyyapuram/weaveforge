import { NextResponse } from "next/server";
import {
  assertAllowedBlobBucket,
  assertBlobPathOwned,
} from "@/storage/server/blob-access";
import { bearerToken, buildTieredBlobStoreForToken, userIdFromToken } from "@/storage/server/blob-api";
import { readStorageConfig } from "@/storage/config";

export async function POST(request: Request) {
  if (readStorageConfig().provider !== "tiered") {
    return NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 });
  }
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { bucket?: string; path?: string };
  try {
    body = (await request.json()) as { bucket?: string; path?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!body.bucket || !body.path) {
    return NextResponse.json({ error: "bucket and path are required." }, { status: 400 });
  }

  try {
    const uid = await userIdFromToken(token);
    assertAllowedBlobBucket(body.bucket);
    assertBlobPathOwned(body.path, uid);
    const store = await buildTieredBlobStoreForToken(token);
    await store.remove(body.bucket, body.path);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Forbidden") ? 403 : message === "Not authenticated." ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
