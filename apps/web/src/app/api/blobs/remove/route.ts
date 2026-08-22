import { NextResponse } from "next/server";
import {
  assertAllowedBlobBucket, assertBlobPathOwned, } from "@/storage/server/blob-access";
import { buildTieredBlobStoreForToken, userIdFromToken } from "@/storage/server/blob-api";
import { blobFailure, tieredBlobToken } from "../_shared";

export async function POST(request: Request) {
  const gate = tieredBlobToken(request);
  if ("refusal" in gate) return gate.refusal;
  const token = gate.token;

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
    return blobFailure(err);
  }
}
