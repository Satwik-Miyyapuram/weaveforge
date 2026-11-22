import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { REPORT_PATH, type MigrationReport, type RunReport } from "../domain/report";
import { browserReportVerified, readMigrationReport } from "../domain/report";

/** This browser install's id (stored under .weaveforge/local/). */
const OWN = "web-a";

/** The browser's own run: its install id, verified into OPFS. */
const RUN: RunReport = {
  startedAt: "2026-11-22T00:00:00.000Z",
  finishedAt: "2026-11-22T00:01:00.000Z",
  sources: ["postgrest"],
  kinds: {},
  blobs: { db: 0, verified: 0 },
  missing: [],
  state: "verified",
  target: "opfs",
  deviceId: OWN,
};

/** A desktop run written later by another device, into its folder. */
const DESKTOP_RUN: RunReport = {
  ...RUN,
  startedAt: "2026-11-23T00:00:00.000Z",
  finishedAt: "2026-11-23T00:01:00.000Z",
  deviceId: "dev-42",
  target: "folder",
};

function report(over: Partial<MigrationReport> = {}): MigrationReport {
  return { version: 1, state: "verified", backup: null, verifiedAt: RUN.finishedAt, target: "opfs", runs: [RUN], ...over };
}

async function sinkWith(text: string | null): Promise<MemorySink> {
  const sink = new MemorySink();
  if (text !== null) await sink.write(REPORT_PATH, text);
  return sink;
}

/** Checks as this browser install (OWN) unless another id is passed. */
function verified(fs: MemorySink, ownDeviceId: string | undefined = OWN): Promise<boolean> {
  return browserReportVerified(fs, ownDeviceId);
}

test("browserReportVerified: true when this device's own run is verified to opfs with no missing rows", async () => {
  assert.equal(await verified(await sinkWith(JSON.stringify(report()))), true);
});

test("browserReportVerified: false when the report is absent (the zip path writes none)", async () => {
  assert.equal(await verified(await sinkWith(null)), false);
});

test("browserReportVerified: false when the report is corrupt", async () => {
  assert.equal(await verified(await sinkWith("{not json")), false);
});

test("browserReportVerified: false when the report has no runs", async () => {
  assert.equal(await verified(await sinkWith(JSON.stringify(report({ runs: [] })))), false);
});

test("browserReportVerified: false when this device's own run is incomplete", async () => {
  const incomplete = { ...RUN, state: "incomplete" as const };
  assert.equal(await verified(await sinkWith(JSON.stringify(report({ runs: [incomplete] })))), false);
});

test("browserReportVerified: false when this device's own run is a folder run", async () => {
  const folder = { ...RUN, target: "folder" as const };
  assert.equal(await verified(await sinkWith(JSON.stringify(report({ runs: [folder] })))), false);
});

test("browserReportVerified: false when the own run has no state (written before per-run state)", async () => {
  const { state: _state, ...noState } = RUN;
  assert.equal(await verified(await sinkWith(JSON.stringify(report({ runs: [noState] })))), false);
});

test("browserReportVerified: false when the verified report still lists a missing row", async () => {
  const dirty = report({ runs: [{ ...RUN, missing: [{ kind: "notes", id: "n1", reason: "x" }] }] });
  assert.equal(await verified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when any device's newest run lists a missing row", async () => {
  const dirty = report({
    runs: [RUN, { ...DESKTOP_RUN, missing: [{ kind: "blobs", id: "b1", reason: "size mismatch" }] }],
  });
  assert.equal(await verified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: a desktop folder run written last does not lock this device out", async () => {
  // The top-level state and target are the last writer's: the desktop folder run.
  const last = report({ target: "folder", runs: [RUN, DESKTOP_RUN] });
  assert.equal(await verified(await sinkWith(JSON.stringify(last))), true);
});

test("browserReportVerified: another device's verified opfs run with no own run gives false", async () => {
  const other = report({ runs: [{ ...RUN, deviceId: "dev-42" }] });
  assert.equal(await verified(await sinkWith(JSON.stringify(other))), false);
});

test("browserReportVerified: own run verified but another device's newest run incomplete gives false", async () => {
  const mixed = report({ runs: [RUN, { ...DESKTOP_RUN, state: "incomplete" as const }] });
  assert.equal(await verified(await sinkWith(JSON.stringify(mixed))), false);
});

test("browserReportVerified: an older dirty run of another device is superseded by its newest run", async () => {
  const superseded = report({
    runs: [
      RUN,
      { ...DESKTOP_RUN, state: "incomplete" as const, startedAt: "2026-11-21T00:00:00.000Z" },
      { ...DESKTOP_RUN, startedAt: "2026-11-24T00:00:00.000Z" },
    ],
  });
  assert.equal(await verified(await sinkWith(JSON.stringify(superseded))), true);
});

test("browserReportVerified: this device's own run is matched by deviceId, not by position", async () => {
  // Asked as dev-9: the only own run is dev-9's, so the browser's run (web-a) is not this device's.
  const runs = report({ runs: [RUN, { ...RUN, deviceId: "dev-9" }] });
  assert.equal(await verified(await sinkWith(JSON.stringify(runs)), "dev-9"), true);
  const noOwn = report({ runs: [RUN] });
  assert.equal(await verified(await sinkWith(JSON.stringify(noOwn)), "dev-9"), false);
});

test("browserReportVerified: browser A verified, browser B with no run gives false", async () => {
  // Reports sync to every device, so A's verified run must not unlock B.
  const aOnly = report({ runs: [RUN] });
  assert.equal(await verified(await sinkWith(JSON.stringify(aOnly)), "web-b"), false);
  assert.equal(await verified(await sinkWith(JSON.stringify(aOnly))), true);
});

test("browserReportVerified: without an ownDeviceId the check is false, even for a verified run with no id", async () => {
  // A run with no deviceId (written before install ids) must not be read as this browser's own run.
  const { deviceId: _id, ...idless } = RUN;
  const legacy = report({ runs: [idless] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(legacy))), false);
  assert.equal(await verified(await sinkWith(JSON.stringify(legacy)), "web-a"), false);
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
