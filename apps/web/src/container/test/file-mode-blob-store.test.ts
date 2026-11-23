import assert from "node:assert/strict";
import test from "node:test";

import { BlobNotFoundError, type IBlobFetcher, type IBlobStore } from "@weaveforge/core";
import { FileModeBlobStore } from "../file-mode-blob-store";
import { FetchingBlobStore } from "../../storage/fetching-blob-store";

/**
 * Files mode keeps personal blobs on the device. Only a shared image is written to the
 * server blob store, through `uploadShared`, which the share path calls.
 */

function recorder(): IBlobStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    upload: async (bucket, path) => {
      calls.push(`upload:${bucket}/${path}`);
    },
    remove: async (bucket, path) => {
      calls.push(`remove:${bucket}/${path}`);
    },
    signedUrls: async (_bucket, paths) => paths.map(() => null),
  };
}

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

test("a personal upload makes zero server calls", async () => {
  const personal = fetcher();
  const server = recorder();
  await new FileModeBlobStore(personal, server).upload("images", "p-1/fig.png", png(), "image/png");
  assert.deepEqual(server.calls, []);
  assert.deepEqual(personal.calls, ["upload:images/p-1/fig.png"]);
});

test("a shared image goes to the server blob route and not to the personal store", async () => {
  const personal = fetcher();
  const server = recorder();
  await new FileModeBlobStore(personal, server).uploadShared("paper-images", "u/p/a.webp", png(), "image/webp");
  assert.deepEqual(server.calls, ["upload:paper-images/u/p/a.webp"]);
  assert.deepEqual(personal.calls, []);
});

test("a personal remove goes to the device store and makes zero server calls", async () => {
  const personal = fetcher();
  const server = recorder();
  await new FileModeBlobStore(personal, server).remove("images", "p-1/fig.png");
  assert.deepEqual(server.calls, []);
  assert.deepEqual(personal.calls, ["remove:images/p-1/fig.png"]);
});

function fetcher(): IBlobFetcher & { calls: string[] } {
  const base = recorder();
  const bytes = new Uint8Array([7, 8]);
  return {
    ...base,
    fetchBytes: async (bucket, path) => {
      base.calls.push(`fetch:${bucket}/${path}`);
      return bytes;
    },
    fetchBlob: async (bucket, path) => {
      base.calls.push(`fetch:${bucket}/${path}`);
      return new Blob([bytes]);
    },
    fetchBlobs: async (bucket, paths) => {
      base.calls.push(...paths.map((p) => `fetch:${bucket}/${p}`));
      return new Map(paths.map((p) => [p, new Blob([bytes])]));
    },
  };
}

test("a personal image is read from the device, not through a signed url", async () => {
  const personal = fetcher();
  const server = recorder();
  const reader = new FetchingBlobStore(new FileModeBlobStore(personal, server));
  assert.deepEqual([...(await reader.fetchBytes("images", "p-1/fig.png"))], [7, 8]);
  assert.equal((await reader.fetchBlob("images", "p-1/fig.png")).size, 2);
  assert.deepEqual([...(await reader.fetchBlobs("images", ["p-1/a.png"])).keys()], ["p-1/a.png"]);
  assert.deepEqual(server.calls, []);
  assert.equal(personal.calls.length, 3);
});
test("fetchBlobs skips a missing or unreadable device file instead of failing the batch", async () => {
  const personal = fetcher();
  personal.fetchBlob = async (bucket, path) => {
    personal.calls.push(`fetch:${bucket}/${path}`);
    if (path === "p-1/missing.png") throw new Error("not found");
    return new Blob([new Uint8Array([7])]);
  };
  const store = new FileModeBlobStore(personal, recorder());
  const got = await store.fetchBlobs("images", ["p-1/a.png", "p-1/missing.png", "p-1/b.png"]);
  assert.deepEqual([...got.keys()], ["p-1/a.png", "p-1/b.png"]);
});
test("fetchBlobs reports an unreadable device file but stays quiet for a missing one", async (t) => {
  const warned: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => void warned.push(args));
  const personal = fetcher();
  personal.fetchBlob = async (bucket, path) => {
    if (path === "p-1/missing.png") throw new BlobNotFoundError(bucket, path);
    if (path === "p-1/bad.png") throw new Error("asset checksum mismatch: assets/images/p-1/bad.png");
    return new Blob([new Uint8Array([7])]);
  };
  const got = await new FileModeBlobStore(personal, recorder()).fetchBlobs("images", ["p-1/missing.png", "p-1/bad.png", "p-1/a.png"]);
  assert.deepEqual([...got.keys()], ["p-1/a.png"]);
  assert.equal(warned.length, 1);
  assert.match(String(warned[0]![0]), /images\/p-1\/bad\.png/);
  assert.match(String((warned[0]![1] as Error).message), /checksum mismatch/);
});