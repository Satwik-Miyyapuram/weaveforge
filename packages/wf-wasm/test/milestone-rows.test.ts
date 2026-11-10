import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { milestoneFromRow, milestoneToRow } from "../src/milestone-rows.js";
import type { MilestoneRowInput } from "../src/milestone-rows.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const base: MilestoneRowInput = {
  id: "m1",
  title: "Draft chapter 2",
  description: null,
  status: "in_progress",
  target_date: null,
  dependencies: null,
  compute: null,
  created_at: "2026-11-05T00:00:00.000Z",
};

test("null lists and optionals become empty lists and absent keys", () => {
  const milestone = milestoneFromRow(base);
  assert.deepEqual(milestone.dependencies, []);
  assert.deepEqual(milestone.compute, []);
  assert.equal("description" in milestone, false);
  assert.equal("targetDate" in milestone, false);
  assert.equal(milestone.createdAt, "2026-11-05T00:00:00.000Z");
});

test("a row with dependencies and a target date keeps them", () => {
  const milestone = milestoneFromRow({
    ...base,
    target_date: "2026-12-01",
    dependencies: [{ kind: "external", label: "Ethics approval" }],
  });
  assert.equal(milestone.targetDate, "2026-12-01");
  assert.deepEqual(milestone.dependencies, [{ kind: "external", label: "Ethics approval" }]);
});

test("writing a milestone uses null for unset optionals", () => {
  const row = milestoneToRow(milestoneFromRow(base));
  assert.equal(row.description, null);
  assert.equal(row.target_date, null);
  assert.deepEqual(row.dependencies, []);
  assert.equal(row.created_at, "2026-11-05T00:00:00.000Z");
  assert.equal(row.status, "in_progress");
});
