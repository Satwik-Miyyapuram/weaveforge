import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];
const BAD = `${REPORT_PATH}.bad`;

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
  } as unknown as ServerSource;
}

const L1 = { id: "l1", text: "from the database" };
const TRUNCATED = '{"version":1,"state":"verified","runs":[{"deviceId":"dev-a"';

test("report unreadable: the bad report is kept as report.json.bad, the run is refused, nothing is written", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, TRUNCATED);
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "report unreadable"));
  assert.equal(await sink.readText(BAD), TRUNCATED, "the unreadable report is preserved, not merged over");
  assert.equal(
    (await sink.list()).some((p) => p.startsWith("logEntries/")),
    false,
    "a refused run writes no data files",
  );
  const written = JSON.parse(await sink.readText(REPORT_PATH));
  assert.equal(written.state, "incomplete");
  assert.deepEqual(
    written.runs.map((r: { deviceId?: string }) => r.deviceId),
    ["dev-b"],
    "only this device's refused run is in the new report; dev-a's run is in report.json.bad",
  );
});

test("report unreadable: an existing report.json.bad is never overwritten, the new one takes a numbered name", async () => {
  const sink = new MemorySink();
  await sink.write(BAD, "older bad report");
  await sink.write(REPORT_PATH, "{ not json");
  await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(await sink.readText(BAD), "older bad report");
  assert.equal(await sink.readText(`${REPORT_PATH}.bad.2`), "{ not json");
});

test("report unreadable: a report whose runs are not an array is unreadable too", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, JSON.stringify({ version: 1, state: "verified", runs: "nope" }));
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "report unreadable"));
});
