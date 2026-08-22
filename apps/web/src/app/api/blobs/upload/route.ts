import { NextResponse } from "next/server";
import {
  assertAllowedBlobBucket, assertBlobPathOwned, } from "@/storage/server/blob-access";
import { buildTieredBlobStoreForToken, userIdFromToken } from "@/storage/server/blob-api";
import { blobFailure, tieredBlobToken } from "../_shared";

export async function POST(request: Request) {
  const gate = tieredBlobToken(request);
  if ("refusal" in gate) return gate.refusal;
  const token = gate.token;

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
    return blobFailure(err);
  }
}
