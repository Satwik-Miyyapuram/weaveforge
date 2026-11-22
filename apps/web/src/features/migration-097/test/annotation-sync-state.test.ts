import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, ServerSource } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const codec: FileCodec = {
  supports: (kind) => kind === "annotations",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Record<string, unknown>) : null),
};

function server(rows: Record<string, unknown[]>): ServerSource {
  return {
    listRows: async (kind: string) => rows[kind] ?? [],
    countRows: async (kind: string) => (rows[kind] ?? []).length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretProviders: async () => [],
  } as unknown as ServerSource;
}

test("an annotation whose server syncState is not local is listed in report.missing, not silently skipped", async () => {
  const rows = {
    annotations: [
      { id: "a1", paperFile: "papers/p.pdf", syncState: "local" },
      { id: "a2", paperFile: "papers/p.pdf", syncState: "pending" },
    ],
  };
  const result = await runWebExport({
    kinds: ["annotations"],
    codec,
    source: server(rows),
    sink: new MemorySink(),
    now: NOW,
    runDeviceId: "dev-a",
  });

  const reasons = result.run.missing.filter((m) => m.kind === "annotations").map((m) => [m.id, m.reason]);
  assert.deepEqual(reasons, [["a2", "unsynced (exported)"]]);
  assert.notEqual(result.state, "verified");
});

test("synced annotations count as exported: three synced rows verify, and a pending one is listed and still written", async () => {
  const synced = {
    annotations: [
      { id: "s1", paperFile: "papers/p.pdf", syncState: "synced" },
      { id: "s2", paperFile: "papers/p.pdf", syncState: "synced" },
      { id: "s3", paperFile: "papers/p.pdf", syncState: "synced" },
    ],
  };
  const sink = new MemorySink();
  const ok = await runWebExport({ kinds: ["annotations"], codec, source: server(synced), sink, now: NOW, runDeviceId: "dev-a" });
  assert.equal(ok.state, "verified");

  const mixed = { annotations: [...synced.annotations, { id: "p1", paperFile: "papers/p.pdf", syncState: "pending" }] };
  const sink2 = new MemorySink();
  const res = await runWebExport({ kinds: ["annotations"], codec, source: server(mixed), sink: sink2, now: NOW, runDeviceId: "dev-a" });
  assert.deepEqual(
    res.run.missing.filter((m) => m.kind === "annotations").map((m) => [m.id, m.reason]),
    [["p1", "unsynced (exported)"]],
  );
  assert.equal(await sink2.exists("annotations/p1.json"), true, "the pending row is still written");
});

test("an annotation with a sync state the export does not know is listed; local and absent states are not", async () => {
  const rows = {
    annotations: [
      { id: "k1", paperFile: "papers/p.pdf", syncState: "local" },
      { id: "k2", paperFile: "papers/p.pdf" },
      { id: "k3", paperFile: "papers/p.pdf", syncState: "archived" },
    ],
  };
  const result = await runWebExport({
    kinds: ["annotations"],
    codec,
    source: server(rows),
    sink: new MemorySink(),
    now: NOW,
    runDeviceId: "dev-a",
  });

  const reasons = result.run.missing.filter((m) => m.kind === "annotations").map((m) => [m.id, m.reason]);
  assert.deepEqual(reasons, [["k3", "unknown sync state (exported)"]]);
});
