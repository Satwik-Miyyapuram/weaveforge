import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlobRef, FileCodec, Row, ServerSource } from "../domain/ports";
import { gateOpfsSwitch } from "../application/opfs-switch-gate";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";

// Same one-file-per-row codec the 0.9.7 web export test uses.
const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

// The server holds `rows` by reference, so a test can write to it between two gate runs.
function server(rows: Record<string, Row[]>, failList = false): ServerSource {
  return {
    listRows: async (kind) => {
      if (failList) throw new Error("connection reset");
      return rows[kind] ?? [];
    },
    countRows: async (kind) => (rows[kind] ?? []).length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async (): Promise<BlobRef[]> => [],
    fetchBlob: async () => {
      throw new Error("no blobs");
    },
    markExported097: async () => {},
    secretProviders: async () => [],
  };
}

const opts = (source: ServerSource, sink: MemorySink) => ({
  kinds: ["logEntries"],
  codec,
  source,
  sink,
  now: NOW,
  runDeviceId: "web-gate-0001",
});

test("0.9.7 verified, then a server write, then the 0.9.8 switch re-exports and the new row is in OPFS", async () => {
  const rows: Record<string, Row[]> = { logEntries: [{ id: "l1", text: "first" }] };
  const sink = new MemorySink();

  // 0.9.7 web export: verified. The gate ignores this report and runs its own export.
  const first = await gateOpfsSwitch(opts(server(rows), sink));
  assert.equal(first.switch, true);

  // A write lands on the server after the 0.9.7 export.
  rows.logEntries!.push({ id: "l2", text: "written after 0.9.7" });

  // 0.9.8 switch: the gate re-exports from the server and verifies the fresh run.
  const second = await gateOpfsSwitch(opts(server(rows), sink));
  assert.equal(second.switch, true);
  assert.equal(second.result.state, "verified");
  assert.equal(second.result.run.kinds.logEntries?.files, 2);

  const paths = (await sink.list()).sort();
  assert.ok(paths.includes("logEntries/l2.json"), "the row written after 0.9.7 must be in OPFS");
});

test("a failed fresh run does not switch, even though the sink still holds the verified 0.9.7 report", async () => {
  const rows: Record<string, Row[]> = { logEntries: [{ id: "l1", text: "first" }] };
  const sink = new MemorySink();

  const first = await gateOpfsSwitch(opts(server(rows), sink));
  assert.equal(first.switch, true);

  // The server fails on the fresh 0.9.8 run.
  const second = await gateOpfsSwitch(opts(server(rows, true), sink));
  assert.equal(second.switch, false);
  assert.notEqual(second.result.state, "verified");
});
