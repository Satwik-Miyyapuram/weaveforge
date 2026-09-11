import { NextResponse } from "next/server";
import {
  assertAllowedBlobBucket, assertBlobPathOwned, } from "@/storage/server/blob-access";
import { buildTieredBlobStoreForToken } from "@/storage/server/blob-api";
import { blobFailure, tieredBlobToken, tieredProviderRefusal } from "../_shared";
import { MAX_UPLOAD_BYTES, exceedsDeclaredLimit } from "./upload-limits";

/**
 * Upload one blob to the tiered store.
 *
 * Four gates, and the order is the point.
 *
 * The storage provider comes first: a deployment that does not run the tiered
 * store should say so rather than answer a question about a route it cannot
 * serve. Then the declared size, because that is a header and nothing else —
 * `request.formData()` buffers the entire multipart body in memory before it
 * returns, and every byte is copied again by `new Uint8Array(await
 * blob.arrayBuffer())` inside the R2 store, so an unbounded body is two copies
 * of a size the client chose. A client that has already said the body is 2 GB
 * does not need the server to read it, or to resolve its token, to be told no.
 * Then auth and path ownership, which are what make the write the caller's to
 * make. Then the parse.
 *
 * Parse last is deliberate: an unauthenticated caller must not be able to make
 * the server buffer a body at all. The declared-size gate already bounds what
 * an authenticated one can send, and the post-parse check on `file.size` covers
 * the case the header cannot — a chunked upload that declares no length.
 */
export async function POST(request: Request) {
  const providerRefusal = tieredProviderRefusal();
  if (providerRefusal) return providerRefusal;

  if (exceedsDeclaredLimit(request.headers.get("content-length"))) {
    return tooLarge();
  }

  const gate = await tieredBlobToken(request);
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
  // The header admitted to nothing, so the parsed part is checked instead. This
  // is the last point before the bytes are copied into the object store.
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge();

  try {
    assertAllowedBlobBucket(bucket);
    assertBlobPathOwned(path, gate.userId);
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

/** The single refusal for both size checks, so they cannot drift in wording. */
function tooLarge() {
  return NextResponse.json(
    { error: `Blob exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.` },
    { status: 413 },
  );
}
