import assert from "node:assert/strict";
import test from "node:test";

import type { IBlobStore } from "@weaveforge/core";
import { FileModeBlobStore } from "../file-mode-blob-store";

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
