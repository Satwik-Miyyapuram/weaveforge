import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { ReadingList, ReadingListTreeNode } from "@weaveforge/core";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runListAction } from "../ui/run-list-action";

before(async () => {
  await loadTestCore();
});

const collectListIds = (tree: ReadingListTreeNode[]) => readyCore().collectListIds(tree);
const reorderedIds = (ids: string[], dragId: string, targetId: string) =>
  readyCore().reorderedIds(ids, dragId, targetId);
const movedIds = (ids: string[], id: string, step: -1 | 1) => readyCore().movedIds(ids, id, step);

function node(id: string, children: ReadingListTreeNode[] = []): ReadingListTreeNode {
  return { list: { id, name: id, sortOrder: 0, createdAt: "" } as ReadingList, children };
}

test("collectListIds: every list in the tree, parents before children (36-07)", () => {
  const tree = [node("a", [node("b", [node("c")]), node("d")]), node("e")];
  assert.deepEqual(collectListIds(tree), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(collectListIds([]), []);
});

test("reorderedIds: the dragged id takes the target's place", () => {
  assert.deepEqual(reorderedIds(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(reorderedIds(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
});

test("reorderedIds: no move for the same id or an unknown one", () => {
  assert.equal(reorderedIds(["a", "b"], "a", "a"), null);
  assert.equal(reorderedIds(["a", "b"], "x", "a"), null);
  assert.equal(reorderedIds(["a", "b"], "a", "x"), null);
});

test("movedIds: one step up or down (36-06)", () => {
  assert.deepEqual(movedIds(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(movedIds(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
});

test("movedIds: no move past either end, or for an unknown id", () => {
  assert.equal(movedIds(["a", "b"], "a", -1), null);
  assert.equal(movedIds(["a", "b"], "b", 1), null);
  assert.equal(movedIds(["a", "b"], "x", 1), null);
});

test("runListAction: clears the error, runs, and reports success", async () => {
  const errors: (string | null)[] = [];
  const ok = await runListAction(async () => {}, (e) => errors.push(e));
  assert.equal(ok, true);
  assert.deepEqual(errors, [null]);
});

test("runListAction: a failure is shown, not thrown (36-01, 36-03, 36-04)", async () => {
  const errors: (string | null)[] = [];
  const ok = await runListAction(async () => {
    throw new Error("network down");
  }, (e) => errors.push(e));
  assert.equal(ok, false);
  assert.equal(errors.length, 2);
  assert.match(errors[1]!, /network down/);
});
