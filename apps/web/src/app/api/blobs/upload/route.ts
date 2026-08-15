import { NextResponse } from "next/server";
import {
  assertAllowedBlobBucket, assertBlobPathOwned, } from "@/storage/server/blob-access";
import { bearerToken, buildTieredBlobStoreForToken, userIdFromToken } from "@/storage/server/blob-api";
import { readStorageConfig } from "@/storage/config";
import { formatError } from "@/lib/format-error";

export async function POST(request: Request) {
  if (readStorageConfig().provider !== "tiered") {
    return NextResponse.json({ error: "BLOB_PROVIDER is not tiered." }, { status: 503 });
  }
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form." }, { status: 400 });
  }
  const bucket = String(form.get("bucket") ?? "");
  const path = String(form.get("path") ?? "");
  const file = form.get("file");
  const contentType = form.get("contentType");
  if (!bucket || !path || !(file instanceof Blob)) {
    return NextResponse.json({ error: "bucket, path, and file are required." }, { status: 400 });
  }

  try {
    const uid = await userIdFromToken(token);
    assertAllowedBlobBucket(bucket);
    assertBlobPathOwned(path, uid);
    const store = await buildTieredBlobStoreForToken(token);
    await store.upload(
      bucket,
      path,
      file,
      typeof contentType === "string" ? contentType : file.type,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = formatError(err);
    const status = message.startsWith("Forbidden") ? 403 : message === "Not authenticated." ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
