import assert from "node:assert/strict";
import test from "node:test";
import type { ReadingList, ReadingListTreeNode } from "@weaveforge/core";

import { pruneHiddenLists } from "../ui/lists-rail";

const list = (id: string, parentId?: string) => ({ id, name: id, parentId, sortOrder: 0, createdAt: "" }) as ReadingList;
const tree: ReadingListTreeNode[] = [
  { list: list("a"), children: [{ list: list("a1", "a"), children: [{ list: list("a2", "a1"), children: [] }] }] },
  { list: list("b"), children: [] },
];

test("nothing hidden keeps the tree as it is", () => {
  const out = pruneHiddenLists(tree, new Set());
  assert.equal(out.tree, tree);
  assert.equal(out.hiddenIds.size, 0);
});

test("a list waiting on its Undo toast leaves the rail and count with its whole subtree", () => {
  const out = pruneHiddenLists(tree, new Set(["list:a"]));
  assert.deepEqual(out.tree.map((n) => n.list.id), ["b"]);
  assert.deepEqual([...out.hiddenIds].sort(), ["a", "a1", "a2"]);
});

test("a hidden sublist is removed under its parent, which stays", () => {
  const out = pruneHiddenLists(tree, new Set(["list:a1"]));
  assert.deepEqual(out.tree.map((n) => n.list.id), ["a", "b"]);
  assert.equal(out.tree[0]!.children.length, 0);
  assert.deepEqual([...out.hiddenIds].sort(), ["a1", "a2"]);
});

test("keys of other kinds are ignored", () => {
  const out = pruneHiddenLists(tree, new Set(["note:a", "milestone:b"]));
  assert.equal(out.tree, tree);
});
