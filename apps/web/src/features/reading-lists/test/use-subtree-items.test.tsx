/**
 * A failed fetch of the shown list's items is the items pane's own error: it
 * used to set the screen error, which replaced the rail and the panes with one
 * message and no way back short of a reload (P2-179).
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { ReadingListTreeNode } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { renderHook } from "@/lib/test/react-harness";
import { useSubtreeItems } from "../ui/use-subtree-items";

before(loadTestCore);

const node = (id: string): ReadingListTreeNode =>
  ({ list: { id, name: id, parentId: null, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" }, children: [] }) as unknown as ReadingListTreeNode;

test("a failed items fetch is reported, and Retry fetches again and clears it", async () => {
  let calls = 0;
  const fetchItems = async () => {
    calls += 1;
    if (calls === 1) throw new Error("network down");
    return [];
  };
  const a = node("a");
  const h = await renderHook((p: { n: ReadingListTreeNode }) => useSubtreeItems(p.n, 0, fetchItems), { n: a });
  await h.flush();
  assert.match(h.current.error ?? "", /network down/);
  h.current.retry();
  await h.flush();
  await h.flush();
  assert.equal(calls, 2);
  assert.equal(h.current.error, null);
  await h.unmount();
});

test("picking another list after a failure clears the error", async () => {
  let calls = 0;
  const fetchItems = async () => {
    calls += 1;
    if (calls === 1) throw new Error("timeout");
    return [];
  };
  const h = await renderHook((p: { n: ReadingListTreeNode }) => useSubtreeItems(p.n, 0, fetchItems), { n: node("a") });
  await h.flush();
  assert.match(h.current.error ?? "", /timeout/);
  await h.rerender({ n: node("b") });
  await h.flush();
  assert.equal(h.current.error, null);
  await h.unmount();
});