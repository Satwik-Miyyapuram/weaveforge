import { test } from "node:test";
import assert from "node:assert/strict";

import { quickOpenResults, scoreMatch } from "../application/quick-open";
import { buildWorkspaceTree, flattenTree } from "../application/workspace-tree";

const DOCUMENTS = flattenTree(
  buildWorkspaceTree({
    notes: [
      { id: "n1", title: "Baselines" },
      { id: "n2", title: "Planning" },
      { id: "n3", title: "Roadmap", parentId: "n2" },
    ],
    papers: [{ id: "p1", title: "Batch Normalization", hasNote: true }],
    reportSections: [{ id: "s1", title: "Baseline Results" }],
  }),
);

const rank = (query: string) => quickOpenResults(DOCUMENTS, query).map((r) => r.node.label);

test("a subsequence matches — you never have to type the whole name", () => {
  assert.equal(rank("bsl")[0], "Baselines");
  assert.equal(scoreMatch("baselines.note.md", "zzz"), null);
});

test("a prefix beats a match scattered across the name", () => {
  const results = quickOpenResults(DOCUMENTS, "bat");
  assert.equal(results[0]!.node.label, "Batch Normalization");
  // "Baselines" also contains b-a-t in order, so this is a ranking test, not a
  // filtering one: both match and the tighter one has to win.
  assert.equal(
    results.some((r) => r.node.label === "Baselines"),
    true,
  );
});

test("typing the kind suffix narrows to that kind, with no filter widget", () => {
  const results = quickOpenResults(DOCUMENTS, ".report");

  assert.deepEqual(
    results.map((r) => r.node.kind),
    ["report_section"],
  );
});

test("an empty query lists the workspace instead of showing nothing", () => {
  assert.equal(quickOpenResults(DOCUMENTS, "   ").length, DOCUMENTS.length);
});

test("a nested note is reachable by its folder as well as its name", () => {
  assert.equal(rank("planning/road")[0], "Roadmap");
});

test("the shorter of two equally good matches wins", () => {
  const short = scoreMatch("notes/plan.note.md", "plan")!;
  const long = scoreMatch("notes/planning/roadmap.note.md", "plan")!;

  assert.equal(short.score > long.score, true);
});

test("matched positions come back for highlighting", () => {
  const match = scoreMatch("notes/baselines.note.md", "base")!;

  assert.deepEqual(
    match.matched.map((index) => "notes/baselines.note.md"[index]),
    ["b", "a", "s", "e"],
  );
});

test("spaces separate terms rather than being searched for", () => {
  assert.equal(rank("batch norm")[0], "Batch Normalization");
});
