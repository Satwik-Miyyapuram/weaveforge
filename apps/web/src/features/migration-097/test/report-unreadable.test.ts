import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { ownReportPath, REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];
const OWN_B = ownReportPath("dev-b");

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

function server(rows: Row[]): ServerSource {
  return {
    listRows: async () => rows,
    secretProviders: async () => [],
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

test("legacy report unreadable: the run is refused, the legacy file is left as it is, and no data is written", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, TRUNCATED);
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason === "report.json is unreadable; restore it from your backup or run the export again"));
  assert.equal(await sink.readText(REPORT_PATH), TRUNCATED,"the legacy report is read-only: never moved, never rewritten");
  assert.equal(
    (await sink.list()).some((p) => p.startsWith("logEntries/")),
    false,
    "a refused run writes no data files",
  );
  const written = JSON.parse(await sink.readText(OWN_B));
  assert.equal(written.state, "incomplete");
  assert.deepEqual(
    written.runs.map((r: { deviceId?: string }) => r.deviceId),
    ["dev-b"],
    "only this device's refused run is written, to its own file",
  );
});

test("own report unreadable: the run is refused by file name, the file stays in place, and no .bad file is made", async () => {
  const sink = new MemorySink();
  await sink.write(OWN_B, "{ not json");
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(
    result.run.missing.some((m) => m.reason === "report-dev-b.json is unreadable; restore it from your backup or run the export again"),
    JSON.stringify(result.run.missing),
  );
  assert.equal(await sink.readText(OWN_B), "{ not json", "the unreadable own file is never renamed or replaced");
  assert.deepEqual(
    (await sink.list()).filter((p) => p.includes(".bad")),
    [],
    "no .bad file is created",
  );
});

test("legacy report whose runs is not an array is unreadable too, and is left untouched", async () => {
  const sink = new MemorySink();
  const legacy = JSON.stringify({ version: 1, state: "verified", runs: "nope" });
  await sink.write(REPORT_PATH, legacy);
  const result = await runWebExport({ kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.equal(result.state, "incomplete");
  assert.ok(result.run.missing.some((m) => m.reason.startsWith("report.json is unreadable")));
  assert.equal(await sink.readText(REPORT_PATH), legacy);
});
