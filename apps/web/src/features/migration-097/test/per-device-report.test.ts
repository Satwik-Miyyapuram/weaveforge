import assert from "node:assert/strict";
import { test } from "node:test";
import { runWebExport } from "../application/run-web-export";
import type { FileCodec, Row, ServerSource } from "../domain/ports";
import { browserReportVerified, MIGRATION_KINDS, ownReportPath, REPORT_PATH } from "../domain/report";
import { MemorySink } from "../infrastructure/memory-sink";

const DIR = ".weaveforge/migration-0.9.7";
const T0 = "2026-11-22T00:00:00.000Z";
const T1 = "2026-11-22T01:00:00.000Z";
const A = "dev-aaaaaaaa";
const B = "dev-bbbbbbbb";
const KINDS = ["logEntries"];

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

function server(): ServerSource {
  return {
    listRows: async () => [{ id: "l1", text: "row" }],
    secretProviders: async () => [],
    countRows: async () => 1,
    pendingOutbox: async () => 0,
    listTrashed: async () => [],
    undecryptable: async () => 0,
    listBlobs: async () => [],
    fetchBlob: async () => new Uint8Array(),
    markExported097: async () => {},
  } as unknown as ServerSource;
}

/** A run that covers every migration kind with nothing missing: clean when verified. */
const CLEAN_KINDS = Object.fromEntries(MIGRATION_KINDS.map((k) => [k, { db: 0, files: 0, written: 0, conflicts: [], trash: 0 }]));

function run(deviceId: string, startedAt: string, extra: Record<string, unknown> = {}) {
  return {
    startedAt,
    finishedAt: startedAt,
    sources: ["server"],
    kinds: CLEAN_KINDS,
    blobs: { db: 0, verified: 0 },
    missing: [],
    deviceId,
    state: "verified",
    target: "opfs",
    backup: null,
    ...extra,
  };
}

function reportText(runs: unknown[]): string {
  return JSON.stringify({ version: 1, state: "verified", backup: null, target: "opfs", runs });
}

test("two devices exporting to one folder each keep their own run", async () => {
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec, source: server(), sink, now: T0, runDeviceId: A });
  await runWebExport({ kinds: KINDS, codec, source: server(), sink, now: T1, runDeviceId: B });

  const a = JSON.parse(await sink.readText(ownReportPath(A)));
  const b = JSON.parse(await sink.readText(ownReportPath(B)));
  assert.deepEqual(
    a.runs.map((r: { deviceId: string }) => r.deviceId),
    [A],
    "device A's run survives device B's export",
  );
  assert.deepEqual(b.runs.map((r: { deviceId: string }) => r.deviceId), [B]);
});

test("a later export never rewrites another device's report file", async () => {
  const sink = new MemorySink();
  await runWebExport({ kinds: KINDS, codec, source: server(), sink, now: T0, runDeviceId: A });
  const before = await sink.readText(ownReportPath(A));
  await runWebExport({ kinds: KINDS, codec, source: server(), sink, now: T1, runDeviceId: B });
  assert.equal(await sink.readText(ownReportPath(A)), before, "A's file is byte-identical after B's run");
});

test("the legacy report.json is read but never written again", async () => {
  const sink = new MemorySink();
  const legacy = reportText([run(A, T0)]);
  await sink.write(REPORT_PATH, legacy);
  await runWebExport({ kinds: KINDS, codec, source: server(), sink, now: T1, runDeviceId: B });
  assert.equal(await sink.readText(REPORT_PATH), legacy, "report.json keeps its bytes");
  const b = JSON.parse(await sink.readText(ownReportPath(B)));
  assert.deepEqual(b.runs.map((r: { deviceId: string }) => r.deviceId), [B]);
});

test("a legacy-only report still reads as verified for its device", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, reportText([run(A, T0)]));
  assert.equal(await browserReportVerified(sink, A), true);
});

test("a report copy beside a device file refuses verification", async () => {
  const sink = new MemorySink();
  await sink.write(ownReportPath(A), reportText([run(A, T0)]));
  await sink.write(`${DIR}/report-${A} (1).json`, "{ not json");
  assert.equal(await browserReportVerified(sink, A), false, "an unreadable copy fails closed");
});

test("another device's dirty newest run blocks verification", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, reportText([run(A, T0, { missing: [{ kind: "logEntries", id: "x", reason: "gone" }] })]));
  await sink.write(ownReportPath(B), reportText([run(B, T0)]));
  assert.equal(await browserReportVerified(sink, B), false);
});

test("the newest run of a device wins across the legacy and its own file", async () => {
  const dirtyNewer = new MemorySink();
  await dirtyNewer.write(REPORT_PATH, reportText([run(A, T0)]));
  await dirtyNewer.write(ownReportPath(A), reportText([run(A, T1, { missing: [{ kind: "x", id: "y", reason: "gone" }] })]));
  assert.equal(await browserReportVerified(dirtyNewer, A), false);

  const cleanNewer = new MemorySink();
  await cleanNewer.write(REPORT_PATH, reportText([run(A, T0, { missing: [{ kind: "x", id: "y", reason: "gone" }] })]));
  await cleanNewer.write(ownReportPath(A), reportText([run(A, T1)]));
  assert.equal(await browserReportVerified(cleanNewer, A), true);
});

test("on a tie in start time a verified run beats an incomplete one for the same device", async () => {
  const sink = new MemorySink();
  await sink.write(REPORT_PATH, reportText([run(A, T0, { state: "incomplete" })]));
  await sink.write(ownReportPath(A), reportText([run(A, T0)]));
  assert.equal(await browserReportVerified(sink, A), true);
});

test("a device with no file of its own is unexported even when another device's file is clean", async () => {
  const sink = new MemorySink();
  await sink.write(ownReportPath(B), reportText([run(B, T0)]));
  assert.equal(await browserReportVerified(sink, A), false);
});
