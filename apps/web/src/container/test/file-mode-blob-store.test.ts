import assert from "node:assert/strict";
import test from "node:test";

import { BlobNotFoundError, type IBlobFetcher } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { FileBlobStore } from "@/backend/providers/files/file-blob-store";
import { FetchingBlobStore } from "@/storage/fetching-blob-store";
import { FileModeBlobStore } from "../file-mode-blob-store";

/**
 * Files mode keeps personal blobs on the device. Only a shared image is written to the
 * server blob store, through `uploadShared`, which the share path calls.
 */

function recorder(): IBlobFetcher & { calls: string[] } {
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
    fetchBytes: async (bucket, path) => {
      throw new BlobNotFoundError(bucket, path);
    },
    fetchBlob: async (bucket, path) => {
      throw new BlobNotFoundError(bucket, path);
    },
    fetchBlobs: async () => new Map(),
  };
}

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

test("a personal upload makes zero server calls", async () => {
  const personal = recorder();
  const server = recorder();
  await new FileModeBlobStore(personal, server).upload("images", "p-1/fig.png", png(), "image/png");
  assert.deepEqual(server.calls, []);
  assert.deepEqual(personal.calls, ["upload:images/p-1/fig.png"]);
});

test("a shared image goes to the server blob route and not to the personal store", async () => {
  const personal = recorder();
  const server = recorder();
  await new FileModeBlobStore(personal, server).uploadShared("paper-images", "u/p/a.webp", png(), "image/webp");
  assert.deepEqual(server.calls, ["upload:paper-images/u/p/a.webp"]);
  assert.deepEqual(personal.calls, []);
});

test("reads come from the device files, so a FetchingBlobStore over it shows a note image (E9)", async () => {
  const fs = new MemoryWorkspaceFs();
  await fs.writeFile("assets/notes/u/p/fig.webp", new Uint8Array([7, 8]));
  const server = recorder();
  const store = new FetchingBlobStore(new FileModeBlobStore(new FileBlobStore(fs), server));
  assert.deepEqual([...(await store.fetchBytes("vault-assets", "u/p/fig.webp"))], [7, 8]);
  assert.equal((await store.fetchBlob("vault-assets", "u/p/fig.webp")).type, "image/webp");
  assert.equal((await store.fetchBlobs("vault-assets", ["u/p/fig.webp"])).get("u/p/fig.webp")?.size, 2);
  await assert.rejects(store.fetchBytes("vault-assets", "u/p/gone.webp"), BlobNotFoundError);
  assert.deepEqual(server.calls, []);
});
