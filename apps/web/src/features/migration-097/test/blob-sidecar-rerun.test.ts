import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { BlobRef, FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";
import { sha256Hex } from "../domain/hash";
import { conflictCopyPath } from "../domain/conflict-path";

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
    countRows: async (kind: string) => (kind === "blobs" ? 1 : 0),
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

test("a user's sidecar that differs from the blob's sha256 is a conflict, not a blob failure", async () => {
  const sink = new MemorySink();
  await sink.write("assets/images/a.webp.sha256", "user-sidecar\nimage/webp");
  const bytes = new Uint8Array([1, 2, 3, 4]);

  const result = await runWebExport({ kinds: [], codec, source: server(() => bytes), sink, now: NOW, runDeviceId: "dev-a" });

  const copy = conflictCopyPath("assets/images/a.webp.sha256", 1);
  const reasons = result.run.missing.map((m) => m.reason);
  assert.ok(reasons.includes("conflict:blobs"), JSON.stringify(reasons));
  assert.ok(!reasons.includes("blob-failed"), "a conflict is not recorded as a failed blob");
  assert.ok((result.run.conflicts ?? []).includes(copy), JSON.stringify(result.run.conflicts));
  assert.equal(await sink.readText("assets/images/a.webp.sha256"), "user-sidecar\nimage/webp", "the user's sidecar is kept");
  assert.notEqual(result.state, "verified");
});

test("a user's sidecar that names another sha256 stops the blob write: no blob lands beside a sidecar it contradicts", async () => {
  const sink = new MemorySink();
  await sink.write("assets/images/a.webp.sha256", "user-sidecar\nimage/webp");

  await runWebExport({ kinds: [], codec, source: server(() => new Uint8Array([1, 2, 3, 4])), sink, now: NOW, runDeviceId: "dev-a" });

  assert.equal(await sink.exists("assets/images/a.webp"), false, "the blob is not written while the sidecar is the user's");
});
