import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { REPORT_PATH, type MigrationReport, type RunReport } from "../domain/report";
import { browserReportVerified, readMigrationReport } from "../domain/report";

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

const MALFORMED: [string, unknown][] = [
  ["runs is not an array", { runs: RUN }],
  ["runs is empty", { runs: [] }],
  ["a run is null", { runs: [null] }],
  ["a run has no missing array", { runs: [{ ...RUN, missing: undefined }] }],
  ["a run's missing is an object", { runs: [{ ...RUN, missing: {} }] }],
];

for (const [label, over] of MALFORMED) {
  test(`readMigrationReport: a report whose ${label} is not a report (null, never throws)`, async () => {
    const sink = await sinkWith(JSON.stringify({ ...report(), ...(over as object) }));
    assert.equal(await readMigrationReport(sink), null);
  });

  test(`browserReportVerified: a report whose ${label} is false, never throws`, async () => {
    const sink = await sinkWith(JSON.stringify({ ...report(), ...(over as object) }));
    assert.equal(await browserReportVerified(sink), false);
  });
}

test("readMigrationReport: a sink whose read throws gives null, never throws", async () => {
  const throwing = { readText: async () => { throw new Error("EIO"); } };
  assert.equal(await readMigrationReport(throwing), null);
  assert.equal(await browserReportVerified(throwing), false);
});

const KIND_OK = { db: 2, files: 2, written: 2, conflicts: [], trash: 0 };

test("browserReportVerified: false when a kind's files do not match its db rows", async () => {
  const dirty = report({ runs: [{ ...RUN, kinds: { notes: { ...KIND_OK, files: 1 } } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when a kind lists conflicts", async () => {
  const dirty = report({ runs: [{ ...RUN, kinds: { notes: { ...KIND_OK, conflicts: ["n1"] } } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when the blobs verified count is short of the db count", async () => {
  const dirty = report({ runs: [{ ...RUN, blobs: { db: 2, verified: 1 } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: a clean verified report with matching kinds and blobs is true", async () => {
  const clean = report({ runs: [{ ...RUN, kinds: { notes: KIND_OK }, blobs: { db: 2, verified: 2 } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(clean))), true);
});

const BAD_SHAPE: [string, Partial<RunReport>][] = [
  ["a kind has no files count", { kinds: { notes: { db: 1 } as never } }],
  ["a kind's conflicts is not an array", { kinds: { notes: { ...KIND_OK, conflicts: "x" as never } } }],
  ["blobs has a string count", { blobs: { db: "2" as never, verified: 2 } }],
];

for (const [label, over] of BAD_SHAPE) {
  test(`readMigrationReport: a report whose ${label} is not a report (null)`, async () => {
    const sink = await sinkWith(JSON.stringify(report({ runs: [{ ...RUN, ...over }] })));
    assert.equal(await readMigrationReport(sink), null);
  });

  test(`browserReportVerified: a report whose ${label} is false`, async () => {
    const sink = await sinkWith(JSON.stringify(report({ runs: [{ ...RUN, ...over }] })));
    assert.equal(await browserReportVerified(sink), false);
  });
}
