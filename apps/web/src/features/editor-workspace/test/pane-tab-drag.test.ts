import assert from "node:assert/strict";
import test from "node:test";
import { setTabDragImage, tabMenuItems } from "../ui/pane-view";

test("the tab menu shows Close's shortcut as the keys to press, never as Mod-w", () => {
  const close = tabMenuItems(0, 1, () => undefined).find((item) => item.id === "close");
  assert.equal(close?.accelerator, "Ctrl+W");
});

/** A dragged tab's picture is the tab alone, so whatever overlaps it on screen (a banner) is never carried along. */
test("a tab drag shows a copy of the tab, held where it was grabbed, removed after the drag starts", async () => {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  const copy = { style: {} as Record<string, string>, remove: () => removed.push(copy) };
  const tab = {
    cloneNode: (deep: boolean) => (assert.equal(deep, true), copy),
    getBoundingClientRect: () => ({ left: 100, top: 20 }),
    parentElement: { appendChild: (node: unknown) => added.push(node) },
  };
  const calls: unknown[][] = [];
  const data = { setDragImage: (...args: unknown[]) => calls.push(args) };

  setTabDragImage(tab as unknown as HTMLElement, data as unknown as DataTransfer, 130, 28);

  assert.deepEqual(added, [copy]);
  assert.deepEqual(calls, [[copy, 30, 8]]);
  assert.equal(copy.style.position, "absolute");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(removed, [copy]);
});
