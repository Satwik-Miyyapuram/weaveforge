import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkspaceTree,
  flattenTree,
  type WorkspaceTreeInput,
} from "../application/workspace-tree";

const EMPTY: WorkspaceTreeInput = { notes: [], papers: [], reportSections: [] };

function roots(input: Partial<WorkspaceTreeInput> = {}) {
  const tree = buildWorkspaceTree({ ...EMPTY, ...input });
  return { tree, notes: tree[0]!, papers: tree[1]!, report: tree[2]! };
}

test("three roots, always, so an empty workspace still shows where things go", () => {
  const { tree } = roots();
  assert.deepEqual(
    tree.map((node) => node.label),
    ["Notes", "Papers", "Report"],
  );
  assert.deepEqual(
    tree.map((node) => node.children.length),
    [0, 0, 0],
  );
});

test("a note nests under its parent and carries the path the mirror would write", () => {
  const { notes } = roots({
    notes: [
      { id: "a", title: "Method" },
      { id: "b", title: "Baselines", parentId: "a" },
    ],
  });

  assert.equal(notes.children.length, 1);
  const method = notes.children[0]!;
  assert.equal(method.key, "vault_page:a");
  assert.equal(method.path, "notes/method/method.note.md");
  assert.equal(method.children[0]!.path, "notes/method/baselines.note.md");
});

test("children sort by label, not by the order the rows arrived in", () => {
  const { notes } = roots({
    notes: [
      { id: "z", title: "Zeta" },
      { id: "a", title: "alpha" },
      { id: "m", title: "Chapter 10" },
      { id: "n", title: "Chapter 2" },
    ],
  });

  assert.deepEqual(
    notes.children.map((node) => node.label),
    ["alpha", "Chapter 2", "Chapter 10", "Zeta"],
  );
});

test("a note whose parent is gone stays visible at the root rather than vanishing", () => {
  const { notes } = roots({ notes: [{ id: "orphan", title: "Orphan", parentId: "deleted" }] });

  assert.deepEqual(
    notes.children.map((node) => node.id),
    ["orphan"],
  );
});

test("a note that claims itself as its parent does not hang the tree", () => {
  const { notes } = roots({ notes: [{ id: "loop", title: "Loop", parentId: "loop" }] });

  assert.equal(notes.children.length, 1);
  assert.equal(notes.children[0]!.children.length, 0);
});

test("a paper with no note is listed and flagged, never hidden", () => {
  const { papers } = roots({
    papers: [
      { id: "p1", title: "Attention Is All You Need", hasNote: true },
      { id: "p2", title: "Batch Norm", hasNote: false },
    ],
  });

  assert.deepEqual(
    papers.children.map((node) => [node.label, node.missingNote ?? false]),
    [
      ["Attention Is All You Need", false],
      ["Batch Norm", true],
    ],
  );
  assert.match(papers.children[0]!.path, /^papers\/.*\.paper\.md$/);
});

test("an untitled entity gets a label rather than an empty row", () => {
  const { notes } = roots({ notes: [{ id: "u", title: "   " }] });

  assert.equal(notes.children[0]!.label, "Untitled");
});

test("flattening drops the folders and keeps every document, depth-first", () => {
  const { tree } = roots({
    notes: [
      { id: "a", title: "Method" },
      { id: "b", title: "Baselines", parentId: "a" },
    ],
    papers: [{ id: "p1", title: "Attention", hasNote: true }],
    reportSections: [{ id: "s1", title: "Results" }],
  });

  assert.deepEqual(
    flattenTree(tree).map((node) => node.key),
    ["vault_page:a", "vault_page:b", "paper:p1", "report_section:s1"],
  );
});
