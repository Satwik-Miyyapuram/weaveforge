import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { REPORT_PATH, type MigrationReport, type RunReport } from "../domain/report";
import { browserReportVerified } from "../domain/report";

const RUN: RunReport = {
  startedAt: "2026-11-22T00:00:00.000Z",
  finishedAt: "2026-11-22T00:01:00.000Z",
  sources: ["postgrest"],
  kinds: {},
  blobs: { db: 0, verified: 0 },
  missing: [],
};

function report(over: Partial<MigrationReport> = {}): MigrationReport {
  return { version: 1, state: "verified", backup: null, verifiedAt: RUN.finishedAt, target: "opfs", runs: [RUN], ...over };
}

async function sinkWith(text: string | null): Promise<MemorySink> {
  const sink = new MemorySink();
  if (text !== null) await sink.write(REPORT_PATH, text);
  return sink;
}

test("browserReportVerified: true only for a verified opfs report with no missing rows", async () => {
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report()))), true);
});

test("browserReportVerified: false when the report is absent (the zip path writes none)", async () => {
  assert.equal(await browserReportVerified(await sinkWith(null)), false);
});

test("browserReportVerified: false when the report is corrupt", async () => {
  assert.equal(await browserReportVerified(await sinkWith("{not json")), false);
});

test("browserReportVerified: false when the state is incomplete", async () => {
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report({ state: "incomplete" })))), false);
});

test("browserReportVerified: false when the state is none", async () => {
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report({ state: "none" })))), false);
});

test("browserReportVerified: false when the target is folder (a desktop export never gates the browser)", async () => {
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report({ target: "folder" })))), false);
});

test("browserReportVerified: false when the target is absent (report written before the target field)", async () => {
  const { target: _target, ...noTarget } = report();
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(noTarget))), false);
});

test("browserReportVerified: false when the verified report still lists a missing row", async () => {
  const dirty = report({ runs: [{ ...RUN, missing: [{ kind: "notes", id: "n1", reason: "x" }] }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when any run in the report lists a missing row", async () => {
  const dirty = report({
    runs: [RUN, { ...RUN, missing: [{ kind: "blobs", id: "b1", reason: "size mismatch" }] }],
  });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});
