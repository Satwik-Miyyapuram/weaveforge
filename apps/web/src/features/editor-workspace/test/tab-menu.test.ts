/** A tab's right-click menu: every item is one pure layout change. */
import assert from "node:assert/strict";
import test from "node:test";
import type { PaneSplit, TabRef } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

const tab = (id: string): TabRef => ({ kind: "vault_page", id });
const ABCD = ["a", "b", "c", "d"].reduce((layout, id) => readyCore().openTab(layout, tab(id)), readyCore().emptyLayout());
const ids = (layout: typeof ABCD, pane = 0) => readyCore().leaves(layout.root)[pane]!.tabs.map((t) => t.id);

test("close drops only the clicked tab", () => {
  assert.deepEqual(ids(readyCore().layoutForTabMenu(ABCD, "pane-1", 1, "close")), ["a", "c", "d"]);
});

test("close others keeps the clicked tab and makes it active", () => {
  const after = readyCore().layoutForTabMenu(ABCD, "pane-1", 2, "close-others");
  assert.deepEqual(ids(after), ["c"]);
  assert.equal(readyCore().leaves(after.root)[0]!.activeIndex, 0);
});

test("close to the right keeps the clicked tab and those before it", () => {
  const after = readyCore().layoutForTabMenu(ABCD, "pane-1", 1, "close-right");
  assert.deepEqual(ids(after), ["a", "b"]);
  // `d` was active; it is gone, so the clicked tab takes over.
  assert.equal(readyCore().leaves(after.root)[0]!.activeIndex, 1);
});

test("close to the right on the last tab changes nothing", () => {
  assert.equal(readyCore().layoutForTabMenu(ABCD, "pane-1", 3, "close-right"), ABCD);
});

test("split right carries the clicked tab, not the active one, into a new pane beside", () => {
  const after = readyCore().layoutForTabMenu(ABCD, "pane-1", 0, "split-right");
  assert.equal((after.root as PaneSplit).direction, "row");
  assert.deepEqual(ids(after, 1), ["a"]);
  assert.equal(after.focusedPaneId, readyCore().leaves(after.root)[1]!.id);
});

test("split down stacks the new pane below", () => {
  const after = readyCore().layoutForTabMenu(ABCD, "pane-1", 2, "split-down");
  assert.equal((after.root as PaneSplit).direction, "column");
  assert.deepEqual(ids(after, 1), ["c"]);
});

test("a pane that does not exist is left alone", () => {
  assert.equal(readyCore().layoutForTabMenu(ABCD, "pane-missing", 0, "close-others"), ABCD);
});
