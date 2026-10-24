import assert from "node:assert/strict";
import test from "node:test";

import type { ReadingList, ReadingListItem, ReadingListTreeNode } from "@weaveforge/core";
import { loadSubtreeItems } from "../application/subtree-items";

/**
 * 36-08: every rendered list node fetched its own items, so a tree of N lists
 * cost N requests per change. The screen now fetches the shown subtree once.
 */

const node = (id: string, children: ReadingListTreeNode[] = []): ReadingListTreeNode => ({
  list: { id, name: id } as ReadingList,
  children,
});
const item = (id: string, listId: string, sortOrder: number): ReadingListItem =>
  ({ id, listId, sortOrder, paperId: id }) as ReadingListItem;

test("a subtree's items come from one fetch covering every list in it", async () => {
  const calls: string[][] = [];
  const tree = node("root", [node("a", [node("a1")]), node("b")]);
  const out = await loadSubtreeItems(tree, async (ids) => {
    calls.push([...ids]);
    return [item("i1", "a", 0), item("i2", "root", 0), item("i3", "a", 1)];
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.sort(), ["a", "a1", "b", "root"]);
  assert.deepEqual(out.get("a")!.map((i) => i.id), ["i1", "i3"]);
  assert.deepEqual(out.get("root")!.map((i) => i.id), ["i2"]);
});

test("a list with no items maps to an empty array, not a missing entry", async () => {
  const out = await loadSubtreeItems(node("root", [node("a")]), async () => []);
  assert.deepEqual(out.get("root"), []);
  assert.deepEqual(out.get("a"), []);
});

test("items for lists outside the subtree are ignored", async () => {
  const out = await loadSubtreeItems(node("root"), async () => [item("x", "elsewhere", 0)]);
  assert.deepEqual([...out.keys()], ["root"]);
  assert.deepEqual(out.get("root"), []);
});

test("a failed fetch rejects", async () => {
  await assert.rejects(
    loadSubtreeItems(node("root"), async () => {
      throw new Error("offline");
    }),
    { message: "offline" },
  );
});
