/** One label per enum value, sentence case, fixed order (D12, D-16, DA-75, DA-76). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPENDENCY_KINDS, EXPERIMENT_STATUSES, PAPER_STATUSES, RELATION_TYPES } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";

test("paper statuses read To read / Reading / Done (D-26)", () => {
  assert.deepEqual(PAPER_STATUSES.map((s) => readyCore().enumLabel("paperStatus", s)), PAPER_STATUSES.map((s) => ({ to_read: "To read", reading: "Reading", read: "Done", skimmed: "Skimmed" })[s]));
});

test("relations are sentence case with every underscore gone", () => {
  assert.equal(readyCore().enumLabel("relation", "builds_on"), "Builds on");
  assert.equal(readyCore().enumLabel("relation", "uses_method"), "Uses method");
  assert.equal(readyCore().enumLabel("relation", "cites"), "Cites");
  for (const t of RELATION_TYPES) assert.match(readyCore().enumLabel("relation", t), /^[A-Z][a-z ]+$/);
});

test("a dependency kind says what it waits for", () => {
  assert.deepEqual(DEPENDENCY_KINDS.map((k) => readyCore().enumLabel("dependency", k)), DEPENDENCY_KINDS.map((k) => ({
    milestone: "Another milestone",
    experiment: "An experiment",
    paper: "A paper",
    external: "Something outside WeaveForge",
  })[k]));
});

test("milestone and experiment statuses", () => {
  assert.equal(readyCore().enumLabel("milestoneStatus", "in_progress"), "In progress");
  assert.equal(readyCore().enumLabel("milestoneStatus", "planned"), "Planned");
  for (const s of EXPERIMENT_STATUSES) assert.match(readyCore().enumLabel("experimentStatus", s), /^[A-Z][a-z]+$/);
});

test("share roles keep one order everywhere: view, comment, edit", () => {
  assert.deepEqual(readyCore().enumOptions("shareAccess"), [
    { value: "view", label: "Can view" },
    { value: "comment", label: "Can comment" },
    { value: "edit", label: "Can edit" },
  ]);
});

test("an unknown value shows itself, humanised, rather than nothing", () => {
  assert.equal(readyCore().enumLabel("relation", "made_up_kind"), "Made up kind");
  assert.equal(readyCore().enumLabel("paperStatus", ""), "");
});
