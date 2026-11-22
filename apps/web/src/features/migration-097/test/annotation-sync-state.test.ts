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
    secretCount: async () => 0,
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
  assert.deepEqual(reasons, [["a2", "syncState pending"]]);
  assert.notEqual(result.state, "verified");
});
