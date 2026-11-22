import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { REPORT_PATH, readMigrationReport } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const NOW = "2026-11-22T00:00:00.000Z";
const KINDS = ["logEntries"];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

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

/** Records every path written, so a test can prove a file was left alone. */
function spied(sink: MemorySink): { sink: MemorySink; writes: string[] } {
  const writes: string[] = [];
  const write = sink.write.bind(sink);
  sink.write = async (path, data) => {
    writes.push(path);
    return write(path, data);
  };
  return { sink, writes };
}

const L1 = { id: "l1", text: "from the database" };
const L2 = { id: "l2", text: "second" };

test("conflict: a differing existing file stays byte-identical, a conflict copy holds the database version, the run lists it", async () => {
  const sink = new MemorySink();
  const userEdit = "my own edit, not the database";
  await sink.write("logEntries/l1.json", userEdit);
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });

  assert.equal(await sink.readText("logEntries/l1.json"), userEdit);
  assert.equal(await sink.readText("logEntries/l1 (conflict).json"), JSON.stringify({ conflictOf: "l1", text: "from the database" }));
  assert.deepEqual(result.run.conflicts, ["logEntries/l1 (conflict).json"]);
  assert.equal(result.state, "incomplete", "a run with a conflict copy is never verified");
  assert.deepEqual(result.run.missing, []);
});

test("conflict: an identical existing file is left alone (no write to it)", async () => {
  const { sink, writes } = spied(new MemorySink());
  await sink.write("logEntries/l1.json", JSON.stringify(L1));
  writes.length = 0;
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });

  assert.ok(!writes.includes("logEntries/l1.json"), "an identical file is never rewritten");
  assert.deepEqual(result.run.conflicts ?? [], []);
  assert.equal(result.state, "verified");
});

test("conflict: a missing file is written with the database version and no conflict is recorded", async () => {
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });

  assert.equal(await sink.readText("logEntries/l1.json"), JSON.stringify(L1));
  assert.deepEqual(result.run.conflicts ?? [], []);
  assert.equal(result.state, "verified");
});

test("conflict: a re-run with the same differing file reuses the copy it already wrote (no copy pile-up)", async () => {
  const sink = new MemorySink();
  await sink.write("logEntries/l1.json", "my own edit");
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });
  const second = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });

  assert.deepEqual(second.run.conflicts, ["logEntries/l1 (conflict).json"]);
  assert.equal(await sink.readText("logEntries/l1 (conflict) 2.json").catch(() => null), null, "no second copy");
});

test("orphans: a row deleted since the last run is listed as an orphan and its file is untouched", async () => {
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1, L2]), sink, now: NOW, runDeviceId: "dev-a" });
  const before = await sink.readText("logEntries/l2.json");

  const second = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-a" });

  assert.deepEqual(second.run.orphans, ["logEntries/l2.json"]);
  assert.equal(await sink.readText("logEntries/l2.json"), before, "the orphan file is never deleted or changed");
  assert.equal(second.state, "verified", "orphans do not block verify");
  const report = await readMigrationReport(sink);
  assert.deepEqual(report?.runs[0]?.orphans, ["logEntries/l2.json"]);
});

test("orphans: another device's files are never flagged; only this device's own previous run is compared", async () => {
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1, L2]), sink, now: NOW, runDeviceId: "dev-a" });

  const other = await runWebExport({ runDeviceId: "dev-test", kinds: KINDS, codec, source: server([L1]), sink, now: NOW, runDeviceId: "dev-b" });

  assert.deepEqual(other.run.orphans ?? [], [], "dev-b never wrote l2, so l2 is not its orphan");
  assert.equal(await sink.readText("logEntries/l2.json"), JSON.stringify(L2), "dev-a's file is untouched");
  const report = await readMigrationReport(sink);
  const devA = report?.runs.find((r) => r.deviceId === "dev-a");
  assert.ok(devA, "dev-b's run replaces only dev-b's entry, so dev-a's run is kept");
  assert.equal(devA.orphans, undefined, "dev-a's own run never reports dev-b's files");
});
