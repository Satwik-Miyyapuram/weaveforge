import assert from "node:assert/strict";
import { test } from "node:test";
import { REPORT_PATH, ownReportPath, type MigrationReport } from "../../domain/report";
import { recordServerMarked, runWebExport } from "../../application/run-web-export";
import { MemorySink } from "../../infrastructure/memory-sink";
import { NOW, fakeCodec, fakeServer, FIXTURE, KINDS, SUPPORTED } from "./helpers";

const WEB_ID = "web-me-0001";
const OTHER_ID = "web-other-0002";

async function ownReport(sink: MemorySink, deviceId = WEB_ID): Promise<MigrationReport> {
  return JSON.parse(await sink.readText(ownReportPath(deviceId))) as MigrationReport;
}

const BASE_RUN = { startedAt: "t", finishedAt: "t", sources: [], kinds: {}, blobs: { db: 0, verified: 0 }, target: "opfs" };

test("skipMark: the export never reads verified and sends no server mark; the device report says markers pending", async () => {
  const { source, calls } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  const result = await runWebExport({ runDeviceId: WEB_ID, kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, skipMark: true });
  assert.equal(result.state, "incomplete");
  assert.equal(result.readyToMark, true);
  assert.deepEqual(result.reconnectProviders, []);
  assert.equal(result.undecryptable, 0);
  assert.equal(calls.some((c) => c.startsWith("mark:")), false, "the caller writes the server mark");
  const report = await ownReport(sink);
  assert.equal(report.state, "incomplete");
  assert.ok(report.runs[0]?.missing.some((m) => m.reason === "markers pending"));
});

test("skipMark then recordServerMarked: the device report reads verified once the caller's mark has run", async () => {
  const { source } = fakeServer({ rows: FIXTURE });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: WEB_ID, kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, skipMark: true });
  await recordServerMarked(sink, WEB_ID);
  const report = await ownReport(sink);
  assert.equal(report.state, "verified");
  assert.equal(report.runs[0]?.state, "verified");
  assert.equal(report.runs[0]?.missing.length, 0);
  assert.equal((await sink.list()).some((p) => p.endsWith(".part") || p.includes(".tmp")), false, "no temp file is left");
});

test("recordServerMarked keeps the report incomplete while any other row is missing", async () => {
  const { source } = fakeServer({ rows: FIXTURE, failKind: "logEntries" });
  const sink = new MemorySink();
  await runWebExport({ runDeviceId: WEB_ID, kinds: KINDS, codec: fakeCodec(SUPPORTED), source, sink, now: NOW, skipMark: true });
  await recordServerMarked(sink, WEB_ID);
  const report = await ownReport(sink);
  assert.equal(report.state, "incomplete");
  assert.ok(report.runs[0]?.missing.some((m) => m.kind === "logEntries"), "the failed kind stays listed");
});

test("recordServerMarked does nothing when this device's run never had markers pending", async () => {
  const sink = new MemorySink();
  const mine = { ...BASE_RUN, deviceId: WEB_ID, state: "incomplete", missing: [] };
  const text = JSON.stringify({ version: 1, state: "incomplete", backup: null, target: "opfs", runs: [mine] });
  await sink.write(ownReportPath(WEB_ID), text);
  await recordServerMarked(sink, WEB_ID);
  assert.equal(await sink.readText(ownReportPath(WEB_ID)), text, "no markers were pending, so nothing is written");
});

test("recordServerMarked touches only this device's file: another device's file and the legacy report.json stay as they were", async () => {
  const sink = new MemorySink();
  const pending = [{ kind: "marker", id: "*", reason: "markers pending" }];
  const other = JSON.stringify({ version: 1, state: "incomplete", backup: null, target: "opfs", runs: [{ ...BASE_RUN, deviceId: OTHER_ID, state: "incomplete", missing: pending }] });
  const legacy = JSON.stringify({ version: 1, state: "incomplete", backup: null, target: "opfs", runs: [{ ...BASE_RUN, deviceId: WEB_ID, state: "incomplete", missing: pending }] });
  await sink.write(ownReportPath(OTHER_ID), other);
  await sink.write(REPORT_PATH, legacy);
  await recordServerMarked(sink, WEB_ID);
  assert.equal(await sink.readText(ownReportPath(OTHER_ID)), other);
  assert.equal(await sink.readText(REPORT_PATH), legacy);
  assert.equal((await sink.list()).includes(ownReportPath(WEB_ID)), false, "no file of its own: nothing is created");
});

test("recordServerMarked leaves an unreadable device report as it is", async () => {
  const sink = new MemorySink();
  await sink.write(ownReportPath(WEB_ID), "{ not json");
  await recordServerMarked(sink, WEB_ID);
  assert.equal(await sink.readText(ownReportPath(WEB_ID)), "{ not json");
  await sink.write(ownReportPath(WEB_ID), JSON.stringify({ version: 1 }));
  await recordServerMarked(sink, WEB_ID);
  assert.equal(await sink.readText(ownReportPath(WEB_ID)), JSON.stringify({ version: 1 }));
});
