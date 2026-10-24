import { strict as assert } from "node:assert";
import { test } from "node:test";

import { BlobNotFoundError, type IBlobFetcher, type IBlobStore } from "@weaveforge/core";

import { FetchingBlobStore } from "../fetching-blob-store";

const unused = async () => {};

test("a store that can read its own bytes is asked directly, not through a signed URL", async () => {
  let signed = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const local: IBlobFetcher = {
    upload: unused,
    remove: unused,
    signedUrls: async (_b, paths) => {
      signed += 1;
      return paths.map(() => "data:image/png;base64,AQID");
    },
    fetchBytes: async () => bytes,
    fetchBlob: async () => new Blob([bytes], { type: "image/png" }),
    fetchBlobs: async (_b, paths) => new Map(paths.map((p) => [p, new Blob([bytes], { type: "image/png" })])),
  };
  const store = new FetchingBlobStore(local);
  assert.deepEqual(await store.fetchBytes("vault-assets", "a.png"), bytes);
  assert.equal((await store.fetchBlob("vault-assets", "a.png")).type, "image/png");
  assert.equal((await store.fetchBlobs("vault-assets", ["a.png", "b.png"])).size, 2);
  assert.equal(signed, 0);
});

test("a write-only store is read through its signed URLs", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(url);
    return new Response(new Uint8Array([9]), { status: 200 });
  }) as typeof fetch;
  try {
    const remote: IBlobStore = {
      upload: unused,
      remove: unused,
      signedUrls: async (_b, paths) => paths.map((p) => `https://cdn/${p}`),
    };
    const store = new FetchingBlobStore(remote);
    const blobs = await store.fetchBlobs("vault-assets", ["a.png"]);
    assert.equal(blobs.get("a.png")?.type, "image/png");
    assert.deepEqual(seen, ["https://cdn/a.png"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** Reads through a signed URL that answers `status`, or no URL at all. */
async function readThrough(url: string | null, status: number): Promise<unknown> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(status === 200 ? new Uint8Array([1]) : null, { status })) as typeof fetch;
  try {
    const remote: IBlobStore = { upload: unused, remove: unused, signedUrls: async () => [url] };
    return await new FetchingBlobStore(remote).fetchBytes("vault-assets", "a.inkb").then(
      () => null,
      (err: unknown) => err,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a blob with no signed URL, or a 404, is not found", async () => {
  assert.ok((await readThrough(null, 200)) instanceof BlobNotFoundError);
  assert.ok((await readThrough("https://cdn/a.inkb", 404)) instanceof BlobNotFoundError);
});

test("a server error is a failure, not a missing blob", async () => {
  const err = await readThrough("https://cdn/a.inkb", 500);
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof BlobNotFoundError));
  assert.match((err as Error).message, /500/);
});
