import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { labSnapshotRowToDomain } from "../src/lab-snapshot-rows.js";
import type { LabSnapshotRow } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const base = {
  id: "s1",
  project_id: "p1",
  title: "Week 3",
  note: null,
  published_at: "2026-02-01T00:00:00Z",
  created_at: "2026-02-01T00:00:00Z",
};

test("a row without content maps to empty milestones and logs", () => {
  const snapshot = labSnapshotRowToDomain({ ...base, content: null } as unknown as LabSnapshotRow);
  assert.deepEqual(snapshot.content.milestones, []);
  assert.deepEqual(snapshot.content.logs, []);
  assert.equal(snapshot.content.experiments, undefined);
});

test("a null note is left out of the snapshot", () => {
  const snapshot = labSnapshotRowToDomain({ ...base, content: null } as unknown as LabSnapshotRow);
  assert.equal("note" in snapshot, false);
  assert.equal(snapshot.projectId, "p1");
  assert.equal(snapshot.publishedAt, "2026-02-01T00:00:00Z");
});

test("a note on the row is kept", () => {
  const snapshot = labSnapshotRowToDomain({
    ...base,
    note: "Shared with the group",
    content: null,
  } as unknown as LabSnapshotRow);
  assert.equal(snapshot.note, "Shared with the group");
});
