import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { BlobRef, FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { sha256Hex } from "../domain/hash";

const NOW = "2026-11-22T00:00:00.000Z";
const REF: BlobRef = { bucket: "images", path: "a.webp", sizeBytes: 4 };
const codec: FileCodec = {
  supports: () => false,
  toFile: () => ({ path: "", text: "" }),
  toRow: () => null,
};

function server(bytes: () => Uint8Array): ServerSource {
  return {
    listRows: async () => [],
    countRows: async () => 0,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [REF],
    fetchBlob: async () => bytes(),
    markExported097: async () => {},
    secretCount: async () => 0,
  } as unknown as ServerSource;
}

test("blob re-run: a blob that changed in the DB, same size, verifies after the re-run (sidecar follows the blob)", async () => {
  const sink = new MemorySink();
  let current = new Uint8Array([1, 2, 3, 4]);
  const src = server(() => current);

  const first = await runWebExport({ kinds: [], codec, source: src, sink, now: NOW, runDeviceId: "dev-a" });
  assert.equal(first.state, "verified");

  current = new Uint8Array([9, 9, 9, 9]);
  const second = await runWebExport({ kinds: [], codec, source: src, sink, now: NOW, runDeviceId: "dev-a" });

  assert.equal(second.state, "verified", JSON.stringify(second.run.missing));
  assert.deepEqual(await sink.readBytes("assets/images/a.webp"), current);
  const sidecar = (await sink.readText("assets/images/a.webp.sha256")).split("\n")[0];
  assert.equal(sidecar, await sha256Hex(current), "sidecar holds the new sha256, not the first run's");
});
