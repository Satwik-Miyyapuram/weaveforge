import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySink } from "../infrastructure/memory-sink";
import { MIGRATION_KINDS, REPORT_PATH, type MigrationReport, type RunReport } from "../domain/report";
import { browserReportVerified, readMigrationRuns, unverifiedDevices } from "../domain/report";

const KIND_OK = { db: 2, files: 2, written: 2, conflicts: [], trash: 0 };

/** Every MIGRATION_KINDS key present and clean: the shape a full verified run writes. */
const ALL_KINDS = Object.fromEntries(MIGRATION_KINDS.map((k) => [k, KIND_OK]));

/** This browser install's id (stored under .weaveforge/local/). */
const OWN = "web-a";

/** The browser's own run: its install id, verified into OPFS. */
const RUN: RunReport = {
  startedAt: "2026-11-22T00:00:00.000Z",
  finishedAt: "2026-11-22T00:01:00.000Z",
  sources: ["postgrest"],
  kinds: ALL_KINDS,
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
  ["a run is null", { runs: [null] }],
  ["a run has no missing array", { runs: [{ ...RUN, missing: undefined }] }],
  ["a run's missing is an object", { runs: [{ ...RUN, missing: {} }] }],
];

for (const [label, over] of MALFORMED) {
  test(`readMigrationRuns: a report whose ${label} is not a report (null, never throws)`, async () => {
    const sink = await sinkWith(JSON.stringify({ ...report(), ...(over as object) }));
    assert.equal(await readMigrationRuns(sink), null);
  });

  test(`browserReportVerified: a report whose ${label} is false, never throws`, async () => {
    const sink = await sinkWith(JSON.stringify({ ...report(), ...(over as object) }));
    assert.equal(await browserReportVerified(sink), false);
  });
}

test("readMigrationRuns: a sink whose read throws gives null, never throws", async () => {
  const throwing = { readText: async () => { throw new Error("EIO"); } };
  assert.equal(await readMigrationRuns(throwing), null);
  assert.equal(await browserReportVerified(throwing), false);
});

test("browserReportVerified: false when a kind's files do not match its db rows", async () => {
  const dirty = report({ runs: [{ ...RUN, kinds: { ...ALL_KINDS, notes: { ...KIND_OK, files: 1 } } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when a kind lists conflicts", async () => {
  const dirty = report({ runs: [{ ...RUN, kinds: { ...ALL_KINDS, notes: { ...KIND_OK, conflicts: ["n1"] } } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: false when the blobs verified count is short of the db count", async () => {
  const dirty = report({ runs: [{ ...RUN, blobs: { db: 2, verified: 1 } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(dirty))), false);
});

test("browserReportVerified: a clean verified report with matching kinds and blobs is true", async () => {
  const clean = report({ runs: [{ ...RUN, blobs: { db: 2, verified: 2 } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(clean))), true);
});

test("browserReportVerified: the latest run per device counts, so an older failed run from that device does not block", async () => {
  const oldFailed = { ...RUN, startedAt: "2026-11-01T00:00:00.000Z", deviceId: "dev-a", missing: [{ kind: "notes", id: "n1", reason: "x" }] };
  const newClean = { ...RUN, startedAt: "2026-11-02T00:00:00.000Z", deviceId: "dev-a" };
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report({ runs: [oldFailed, newClean] })))), true);
});

test("browserReportVerified: a failed latest run from another device still blocks", async () => {
  const clean = { ...RUN, deviceId: "dev-a" };
  const failed = { ...RUN, startedAt: "2026-11-02T00:00:00.000Z", deviceId: "dev-b", missing: [{ kind: "notes", id: "n1", reason: "x" }] };
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(report({ runs: [clean, failed] })))), false);
});

test("unverifiedDevices: names the device whose latest run is not clean, so the status UI can say where to re-run", () => {
  const clean = { ...RUN, deviceId: "dev-a" };
  const failed = { ...RUN, startedAt: "2026-11-02T00:00:00.000Z", deviceId: "dev-b", missing: [{ kind: "notes", id: "n1", reason: "x" }] };
  assert.deepEqual(unverifiedDevices(report({ runs: [clean, failed] })), ["dev-b"]);
  assert.deepEqual(unverifiedDevices(report({ runs: [clean] })), []);
});

test("browserReportVerified: false when a run's kinds is empty (every MIGRATION_KINDS key must be present)", async () => {
  const empty = report({ runs: [{ ...RUN, kinds: {} }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(empty))), false);
});

test("browserReportVerified: false when a run's kinds covers only a subset of MIGRATION_KINDS", async () => {
  const kinds = Object.fromEntries(MIGRATION_KINDS.filter((k) => k !== "ink").map((k) => [k, KIND_OK]));
  const subset = report({ runs: [{ ...RUN, kinds, blobs: { db: 2, verified: 2 } }] });
  assert.equal(await browserReportVerified(await sinkWith(JSON.stringify(subset))), false);
});

const BAD_SHAPE: [string, Partial<RunReport>][] = [
  ["a kind has no files count", { kinds: { notes: { db: 1 } as never } }],
  ["a kind's conflicts is not an array", { kinds: { notes: { ...KIND_OK, conflicts: "x" as never } } }],
  ["blobs has a string count", { blobs: { db: "2" as never, verified: 2 } }],
];

for (const [label, over] of BAD_SHAPE) {
  test(`readMigrationRuns: a report whose ${label} is not a report (null)`, async () => {
    const sink = await sinkWith(JSON.stringify(report({ runs: [{ ...RUN, ...over }] })));
    assert.equal(await readMigrationRuns(sink), null);
  });

  test(`browserReportVerified: a report whose ${label} is false`, async () => {
    const sink = await sinkWith(JSON.stringify(report({ runs: [{ ...RUN, ...over }] })));
    assert.equal(await browserReportVerified(sink), false);
  });
}
