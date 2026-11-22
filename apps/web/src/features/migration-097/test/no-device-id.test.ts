import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { BlobRef, FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const REF: BlobRef = { bucket: "images", path: "a.webp", sizeBytes: 4 };
const codec: FileCodec = {
  supports: () => false,
  toFile: () => ({ path: "", text: "" }),
  toRow: () => null,
};

function server(): ServerSource {
  return {
    listRows: async () => [],
    countRows: async () => 0,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [REF],
    fetchBlob: async () => new Uint8Array([1, 2, 3, 4]),
    markExported097: async () => {},
    secretCount: async () => 0,
  } as unknown as ServerSource;
}

test("web run without runDeviceId is refused with a fixed reason and writes no blob", async () => {
  const sink = new MemorySink();
  const result = await runWebExport({ kinds: [], codec, source: server(), sink, now: NOW });

  assert.notEqual(result.state, "verified");
  assert.equal(result.state, "incomplete");
  assert.deepEqual(
    result.run.missing.map((m) => m.reason),
    ["device id missing"],
  );
  assert.equal(result.run.deviceId, undefined, "no invented device id is recorded");
  const written = (await sink.list()).filter((p) => !p.startsWith(".weaveforge/"));
  assert.deepEqual(written, [], "nothing is written under the export root");
});
