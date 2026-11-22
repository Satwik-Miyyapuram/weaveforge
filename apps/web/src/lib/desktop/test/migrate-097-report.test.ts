import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeMigrationReport } from "../migrate-097-report";

const RUN_OLD = {
  startedAt: "2026-11-21T10:00:00Z",
  finishedAt: "2026-11-21T10:01:00Z",
  sources: ["local"],
  kinds: { notes: { db: 1, files: 0, written: 0, conflicts: [] } },
  blobs: { db: 0, verified: 0 },
  missing: [],
};

const RUN_LAST = {
  startedAt: "2026-11-22T09:00:00Z",
  finishedAt: "2026-11-22T09:05:00Z",
  sources: ["local", "server"],
  kinds: {
    notes: { db: 3, files: 3, written: 3, conflicts: ["notes/a.md.migrated-0.9.7.md"] },
    papers: { db: 2, files: 2, written: 1, conflicts: [] },
  },
  blobs: { db: 4, verified: 4 },
  missing: [{ kind: "comments", id: "c1", reason: "parent not found" }],
};

test("summarises the latest run with per-kind counts, conflicts and missing rows", () => {
  const summary = summarizeMigrationReport({
    version: 1,
    state: "incomplete",
    backup: ".weaveforge/migration-0.9.7/pre-migration.dump",
    runs: [RUN_OLD, RUN_LAST],
  });
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

test("a report with no runs has no kinds and no missing rows", () => {
  const summary = summarizeMigrationReport({ version: 1, state: "verified", backup: "b.dump", runs: [] });
  assert.ok(summary);
  assert.equal(summary.state, "verified");
  assert.deepEqual(summary.kinds, []);
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.blobs, { db: 0, verified: 0 });
});

test("an unparsable or unknown state is not a summary", () => {
  assert.equal(summarizeMigrationReport(null), null);
  assert.equal(summarizeMigrationReport("garbage"), null);
  assert.equal(summarizeMigrationReport({ version: 1, state: "maybe", runs: [] }), null);
});
