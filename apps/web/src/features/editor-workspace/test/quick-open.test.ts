import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupResults,
  isPickEnter,
  paintedOrder,
  quickOpenResults,
  scoreMatch,
  stepCursor,
  titleOf,
  type QuickOpenResult,
} from "../application/quick-open";
import { buildWorkspaceTree, flattenTree, type WorkspaceTreeNode } from "../application/workspace-tree";

const DOCUMENTS = flattenTree(
  buildWorkspaceTree({
    projectRoot: "",
    notes: [
      { id: "n1", title: "Baselines" },
      { id: "n2", title: "Planning" },
      { id: "n3", title: "Roadmap", parentId: "n2" },
    ],
    papers: [{ id: "p1", title: "Batch Normalization", hasNote: true }],
    reportSections: [{ id: "s1", title: "Baseline Results" }],
  }),
);

const rank = (query: string) => quickOpenResults(DOCUMENTS, query).map((r) => titleOf(r.node));

test("a subsequence matches — you never have to type the whole name", () => {
  assert.equal(rank("bsl")[0], "Baselines");
  assert.equal(scoreMatch("baselines.note.md", "zzz"), null);
});

test("a prefix beats a match scattered across the name", () => {
  const results = quickOpenResults(DOCUMENTS, "bat");
  assert.equal(titleOf(results[0]!.node), "Batch Normalization");
  // "Baselines" also contains b-a-t in order, so this is a ranking test, not a
  // filtering one: both match and the tighter one has to win.
  assert.equal(
    results.some((r) => titleOf(r.node) === "Baselines"),
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

test("results group under the explorer's root order, not by score", () => {
  const groups = groupResults(quickOpenResults(DOCUMENTS, "a"));
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Notes", "Papers", "PDFs", "Report"],
  );
});

test("score order is preserved inside a group", () => {
  const results = quickOpenResults(DOCUMENTS, "b");
  const groups = groupResults(results);
  const notes = groups.find((group) => group.kind === "vault_page")!;

  const ranked = results.filter((result) => result.node.kind === "vault_page");
  assert.deepEqual(
    notes.results.map((result) => result.node.label),
    ranked.map((result) => result.node.label),
  );
});

test("a group with no hits is left out rather than shown empty", () => {
  const groups = groupResults(quickOpenResults(DOCUMENTS, "batch"));
  assert.deepEqual(
    groups.map((group) => group.kind),
    ["paper", "paper_pdf"],
  );
});

test("every result appears in exactly one group", () => {
  const results = quickOpenResults(DOCUMENTS, "a");
  const grouped = groupResults(results).flatMap((group) => group.results);
  assert.equal(grouped.length, results.length);
  assert.deepEqual(new Set(grouped), new Set(results));
});

test("highlight indices still point at the typed letters after a character that lower-cases to two", () => {
  // "İ" (U+0130) lower-cases to two code units, which used to shift every later index.
  const node: WorkspaceTreeNode = {
    key: "vault_page:n9",
    kind: "vault_page",
    id: "n9",
    label: "Plan",
    path: "İdeas/plan.note.md",
    children: [],
  };
  const [hit] = quickOpenResults([node], "plan");
  assert.equal(hit!.matched.map((index) => node.path[index]).join(""), "plan");
});

test("a non-ASCII capital that lower-cases to two units still matches its plain letters", () => {
  const node: WorkspaceTreeNode = {
    key: "vault_page:n9",
    kind: "vault_page",
    id: "n9",
    label: "Ideas",
    path: "İdeas/ideas.note.md",
    children: [],
  };
  assert.deepEqual(quickOpenResults([node], "ideas")[0]?.matched.slice(0, 5), [0, 1, 2, 3, 4]);
});

test("a kind with no heading yet still gets a group, after the known ones", () => {
  const results = quickOpenResults(DOCUMENTS, "a");
  const stranger: QuickOpenResult = {
    node: {
      key: "experiment:x",
      kind: "experiment",
      id: "x",
      label: "Ablation",
      path: "experiments/ablation.experiment.md",
      children: [],
    },
    score: 99,
    matched: [],
  };
  const groups = groupResults([stranger, ...results]);
  assert.equal(groups[groups.length - 1]!.kind, "experiment");
  assert.equal(groups[groups.length - 1]!.label, "Experiment");
});

// 28-03: the arrows and Enter walk the rows in the order they are painted.
test("paintedOrder follows the groups, not the score order", () => {
  const results = quickOpenResults(DOCUMENTS, "b");
  const kinds = new Set(results.map((r) => r.node.kind));
  assert.ok(kinds.size > 1, "the query must mix kinds");
  const painted = paintedOrder(results);
  assert.deepEqual(painted, groupResults(results).flatMap((g) => g.results));
  assert.notDeepEqual(painted, results, "score order interleaves kinds, so the two differ");
});

test("paintedOrder of no results is empty", () => {
  assert.deepEqual(paintedOrder([]), []);
});

// 28-09: Enter that confirms an IME composition does not pick a row.
test("isPickEnter ignores Enter while an IME is composing", () => {
  assert.equal(isPickEnter({ key: "Enter", nativeEvent: { isComposing: false } }), true);
  assert.equal(isPickEnter({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(isPickEnter({ key: "Enter", keyCode: 229, nativeEvent: {} }), false);
  assert.equal(isPickEnter({ key: "a", nativeEvent: { isComposing: false } }), false);
});

test("every result of a kind with no heading is kept, not only the first", () => {
  const row = (id: string, score: number): QuickOpenResult => ({
    node: { key: `experiment:${id}`, kind: "experiment", id, label: id, path: `experiments/${id}.experiment.md`, children: [] },
    score,
    matched: [],
  });
  const groups = groupResults([row("a", 30), row("b", 20), row("c", 10)]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.results.map((r) => r.node.id),
    ["a", "b", "c"],
  );
  assert.equal(paintedOrder([row("a", 30), row("b", 20)]).length, 2);
});

test("the arrows wrap: down from the last row lands on the first, up from the first on the last", () => {
  assert.equal(stepCursor(0, 1, 3), 1);
  assert.equal(stepCursor(2, 1, 3), 0);
  assert.equal(stepCursor(0, -1, 3), 2);
  assert.equal(stepCursor(1, -1, 3), 0);
  // A cursor left past the end by a shorter list steps from the last row.
  assert.equal(stepCursor(7, -1, 3), 1);
  // No rows: the cursor stays on row 0 rather than going negative.
  assert.equal(stepCursor(0, 1, 0), 0);
  assert.equal(stepCursor(0, -1, 0), 0);
});
