import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeMigrationReport } from "../migrate-097-report";

const DEVICE = "dev-a";

const RUN_OLD = {
  deviceId: DEVICE,
  startedAt: "2026-11-21T10:00:00Z",
  finishedAt: "2026-11-21T10:01:00Z",
  sources: ["local"],
  kinds: { notes: { db: 1, files: 0, written: 0, conflicts: [] } },
  blobs: { db: 0, verified: 0 },
  missing: [],
};

const RUN_LAST = {
  deviceId: DEVICE,
  startedAt: "2026-11-22T09:00:00Z",
  finishedAt: "2026-11-22T09:05:00Z",
  backup: ".weaveforge/migration-0.9.7/pre-migration.dump",
  sources: ["local", "server"],
  kinds: {
    notes: { db: 3, files: 3, written: 3, conflicts: ["notes/a.md.migrated-0.9.7.md"] },
    papers: { db: 2, files: 2, written: 1, conflicts: [] },
  },
  blobs: { db: 4, verified: 4 },
  missing: [{ kind: "comments", id: "c1", reason: "parent not found" }],
};

test("summarises this device's latest run with per-kind counts, conflicts and missing rows", () => {
  const summary = summarizeMigrationReport(
    {
      version: 1,
      state: "incomplete",
      backup: ".weaveforge/migration-0.9.7/pre-migration.dump",
      runs: [RUN_OLD, RUN_LAST],
    },
    DEVICE,
  );
  assert.ok(summary);
  assert.equal(summary.state, "incomplete");
  assert.equal(summary.backup, ".weaveforge/migration-0.9.7/pre-migration.dump");
  assert.deepEqual(summary.kinds, [
    { kind: "notes", db: 3, files: 3, written: 3, conflicts: ["notes/a.md.migrated-0.9.7.md"] },
    { kind: "papers", db: 2, files: 2, written: 1, conflicts: [] },
  ]);
  assert.deepEqual(summary.conflicts, ["notes/a.md.migrated-0.9.7.md"]);
  assert.deepEqual(summary.missing, [{ kind: "comments", id: "c1", reason: "parent not found" }]);
  assert.deepEqual(summary.blobs, { db: 4, verified: 4 });
});

test("a verified report with no runs from this device is not verified for this device", () => {
  const summary = summarizeMigrationReport({ version: 1, state: "verified", backup: "b.dump", runs: [] }, DEVICE);
  assert.ok(summary);
  assert.equal(summary.state, "incomplete");
  assert.deepEqual(summary.kinds, []);
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.blobs, { db: 0, verified: 0 });
});

test("an unparsable or unknown state is not a summary", () => {
  assert.equal(summarizeMigrationReport(null, DEVICE), null);
  assert.equal(summarizeMigrationReport("garbage", DEVICE), null);
  assert.equal(summarizeMigrationReport({ version: 1, state: "maybe", runs: [] }, DEVICE), null);
});

test("with this device's id, the summary uses that device's run, not another device's latest run", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "incomplete", runs: [{ ...RUN_OLD, deviceId: "dev-a" }, { ...RUN_LAST, deviceId: "dev-b" }] },
    "dev-a",
  );
  assert.ok(summary);
  assert.deepEqual(summary.kinds, [{ kind: "notes", db: 1, files: 0, written: 0, conflicts: [] }]);
  assert.deepEqual(summary.missing, []);
});

test("with this device's id and no run from it, the summary has no kinds or missing rows", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "incomplete", runs: [{ ...RUN_LAST, deviceId: "dev-b" }] },
    "dev-a",
  );
  assert.ok(summary);
  assert.deepEqual(summary.kinds, []);
  assert.deepEqual(summary.missing, []);
});

test("a device with no run of its own never inherits a top-level verified state or backup", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "verified", backup: "top.dump", runs: [{ ...RUN_LAST, deviceId: "dev-b" }] },
    "dev-a",
  );
  assert.ok(summary);
  assert.equal(summary.state, "incomplete");
  assert.equal(summary.backup, null);
});

test("the run's own backup is shown in preference to the top-level backup", () => {
  const summary = summarizeMigrationReport(
    {
      version: 1,
      state: "verified",
      backup: "top.dump",
      runs: [{ ...RUN_LAST, backup: "run-a.dump" }],
    },
    DEVICE,
  );
  assert.ok(summary);
  assert.equal(summary.backup, "run-a.dump");
});

test("a top-level verified state does not make this device verified while its own run has a missing row", () => {
  const summary = summarizeMigrationReport({ version: 1, state: "verified", runs: [RUN_LAST] }, DEVICE);
  assert.ok(summary);
  assert.equal(summary.state, "incomplete");
});

test("this device is verified when its own run has no missing rows and equal counts, whatever the top level says", () => {
  const clean = {
    ...RUN_OLD,
    kinds: { notes: { db: 2, files: 2, written: 2, conflicts: [] } },
    blobs: { db: 1, verified: 1 },
    missing: [],
  };
  const summary = summarizeMigrationReport({ version: 1, state: "incomplete", runs: [clean] }, DEVICE);
  assert.ok(summary);
  assert.equal(summary.state, "verified");
});

test("an empty device id matches no run, even a run whose deviceId is empty", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "verified", runs: [{ ...RUN_LAST, deviceId: "" }] },
    "",
  );
  assert.ok(summary);
  assert.equal(summary.state, "incomplete");
  assert.deepEqual(summary.kinds, []);
  assert.equal(summary.backup, null);
});

const CLEAN_RUN = {
  ...RUN_OLD,
  kinds: { notes: { db: 2, files: 2, written: 2, conflicts: [] } },
  blobs: { db: 0, verified: 0 },
  missing: [],
};

test("a top-level removing state keeps this device's verified summary and adds its removal state", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "removing", runs: [CLEAN_RUN], removals: { [DEVICE]: { state: "removing" } } },
    DEVICE,
  );
  assert.ok(summary);
  assert.equal(summary.state, "verified");
  assert.equal(summary.removal, "removing");
  assert.deepEqual(summary.kinds, [{ kind: "notes", db: 2, files: 2, written: 2, conflicts: [] }]);
});

test("a top-level removed state keeps this device's verified summary and adds its removal state", () => {
  const summary = summarizeMigrationReport(
    { version: 1, state: "removed", runs: [CLEAN_RUN], removals: { [DEVICE]: { state: "removed" } } },
    DEVICE,
  );
  assert.ok(summary);
  assert.equal(summary.state, "verified");
  assert.equal(summary.removal, "removed");
});
