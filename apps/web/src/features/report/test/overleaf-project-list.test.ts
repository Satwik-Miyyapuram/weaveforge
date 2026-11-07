import assert from "node:assert/strict";
import { test } from "node:test";

import type { LinkedReport } from "../ui/linked-overleaf-api";
import { filterOverleafProjects, mergeOverleafProjects } from "../lib/overleaf-project-list";

const report = (id: string, overleafId: string, title: string): LinkedReport => ({
  id, project_id: "wf1", title, connection_id: "c1", overleaf_project_id: overleafId,
  entry_file: "main.tex", external_url: null, last_fetched_at: null, section_targets: {},
});

test("account projects and linked reports merge on the Overleaf project id", () => {
  const rows = mergeOverleafProjects(
    [{ id: "a", name: "Paper A" }, { id: "t", name: "Thesis" }],
    [report("r1", "t", "MSc thesis")],
  );
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.inAccount, r.report?.id ?? null]), [
    ["t", "Thesis", true, "r1"],
    ["a", "Paper A", true, null],
  ]);
});

test("linked projects come first, then by name; a link outside the account keeps its title", () => {
  const rows = mergeOverleafProjects(
    [{ id: "b", name: "beta" }, { id: "a", name: "Alpha" }],
    [report("r2", "x", "Zeta report")],
  );
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.inAccount]), [
    ["x", "Zeta report", false],
    ["a", "Alpha", true],
    ["b", "beta", true],
  ]);
});

test("with no sign-in, the list is the linked reports alone", () => {
  const rows = mergeOverleafProjects(null, [report("r1", "t", "Thesis")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.inAccount, false);
});

test("two links to one Overleaf project make one row (the first link)", () => {
  const rows = mergeOverleafProjects(null, [report("r1", "t", "One"), report("r2", "t", "Two")]);
  assert.deepEqual(rows.map((r) => r.report?.id), ["r1"]);
});

test("search matches the name or the linked title, ignoring case and spaces", () => {
  const rows = mergeOverleafProjects([{ id: "t", name: "Thesis" }, { id: "a", name: "Paper A" }], [report("r1", "t", "MSc report")]);
  assert.deepEqual(filterOverleafProjects(rows, "  thes ").map((r) => r.id), ["t"]);
  assert.deepEqual(filterOverleafProjects(rows, "msc").map((r) => r.id), ["t"]);
  assert.deepEqual(filterOverleafProjects(rows, "").map((r) => r.id), ["t", "a"]);
  assert.deepEqual(filterOverleafProjects(rows, "nothing"), []);
});
