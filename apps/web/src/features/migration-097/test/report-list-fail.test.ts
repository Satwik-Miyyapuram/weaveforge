import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

function server(rows: Row[]): ServerSource {
  return {
    listRows: async () => rows,
    countRows: async () => rows.length,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
    secretCount: async () => 0,
  } as unknown as ServerSource;
}

const L1 = { id: "l1", text: "from the database" };

/** A sink whose directory listing always fails, so only readText can tell what report.json holds. */
function listFailingSink(reportText: string | null, reportReadFails: boolean): MemorySink {
  const sink = new MemorySink();
  if (reportText !== null) void sink.write(REPORT_PATH, reportText);
  const readText = sink.readText.bind(sink);
  sink.list = async () => {
    throw new Error("listing down");
  };
  sink.readText = async (path: string) => {
    if (path === REPORT_PATH && reportReadFails) throw new Error("read down");
    return readText(path);
  };
  return sink;
}

test("report listing fails but report.json reads: this device keeps the other device's run", async () => {
  const report = {
    version: 1,
    state: "incomplete",
    runs: [{ deviceId: "dev-a", state: "incomplete", at: NOW, kinds: {}, blobs: { db: 0, verified: 0 }, missing: [] }],
  };
  const sink = listFailingSink(JSON.stringify(report), false);
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.ok(!result.run.missing.some((m) => m.reason === "report unreadable"), "a readable report is not refused");
  const written = JSON.parse(await sink.readText(REPORT_PATH));
  assert.deepEqual(
    written.runs.map((r: { deviceId?: string }) => r.deviceId),
    ["dev-a", "dev-b"],
    "the other device's run is kept when the listing fails",
  );
});

test("report listing fails and report.json cannot be read: refused, the report is never replaced", async () => {
  const truncated = '{"version":1,"state":"verified","runs":[{"deviceId":"dev-a"';
  const sink = listFailingSink(truncated, true);
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "report unreadable"));
  // Read through the base class: the patched readText refuses report.json on purpose.
  const raw = await MemorySink.prototype.readText.call(sink, REPORT_PATH);
  assert.equal(raw, truncated, "the unreadable report is not replaced");
});
