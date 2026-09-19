import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activateTab,
  activeTab,
  activeTabKey,
  activeTabRef,
  closeTab,
  emptyLayout,
  focusPane,
  hydrateTabModes,
  leaves,
  moveTab,
  openTab,
  pruneLayout,
  setRatio,
  setTabMode,
  splitPane,
  tabAt,
  tabMode,
  toggleTabModeAt,
  type PaneLayout,
  type PaneSplit,
} from "../application/pane-tree";

const A = { kind: "vault_page", id: "a" };
const B = { kind: "vault_page", id: "b" };
const C = { kind: "paper", id: "c" };

const labels = (layout: PaneLayout) =>
  leaves(layout.root).map((leaf) => leaf.tabs.map((tab) => tab.id).join(","));

test("opening a document twice focuses the open tab instead of duplicating it", () => {
  let layout = openTab(openTab(emptyLayout(), A), B);
  assert.deepEqual(labels(layout), ["a,b"]);

  layout = openTab(layout, A);
  assert.deepEqual(labels(layout), ["a,b"]);
  assert.deepEqual(activeTab(leaves(layout.root)[0]!), A);
});

test("a split carries the active tab across, because that is what splitting means", () => {
  const layout = splitPane(openTab(openTab(emptyLayout(), A), B), "pane-1", "row", "pane-2");

  assert.deepEqual(labels(layout), ["a,b", "b"]);
  assert.equal(layout.focusedPaneId, "pane-2");
  assert.equal((layout.root as PaneSplit).direction, "row");
});

test("splitting an empty pane leaves an empty pane rather than failing", () => {
  const layout = splitPane(emptyLayout(), "pane-1", "column", "pane-2");

  assert.deepEqual(labels(layout), ["", ""]);
});

test("splitting a pane that is not there changes nothing", () => {
  const before = openTab(emptyLayout(), A);
  assert.equal(splitPane(before, "pane-missing", "row"), before);
});

test("closing the last tab of a split collapses the split", () => {
  const layout = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");
  const closed = closeTab(layout, "pane-2", 0);

  assert.equal(closed.root.type, "leaf");
  assert.deepEqual(labels(closed), ["a"]);
  // Focus cannot stay on a pane that no longer exists.
  assert.equal(closed.focusedPaneId, "pane-1");
});

test("the last pane survives its last tab — there is always somewhere to open", () => {
  const closed = closeTab(openTab(emptyLayout(), A), "pane-1", 0);

  assert.equal(closed.root.type, "leaf");
  assert.deepEqual(labels(closed), [""]);
  assert.equal(activeTab(leaves(closed.root)[0]!), undefined);
});

test("closing a tab left of the active one keeps the same document showing", () => {
  let layout = openTab(openTab(openTab(emptyLayout(), A), B), C);
  layout = activateTab(layout, "pane-1", 2);

  const closed = closeTab(layout, "pane-1", 0);
  assert.deepEqual(activeTab(leaves(closed.root)[0]!), C);
});

test("closing the rightmost active tab lands on the new rightmost", () => {
  let layout = openTab(openTab(emptyLayout(), A), B);
  layout = activateTab(layout, "pane-1", 1);

  const closed = closeTab(layout, "pane-1", 1);
  assert.deepEqual(activeTab(leaves(closed.root)[0]!), A);
});

test("an out-of-range activation is clamped, not stored", () => {
  const layout = activateTab(openTab(emptyLayout(), A), "pane-1", 99);

  assert.equal(leaves(layout.root)[0]!.activeIndex, 0);
});

test("a tab moved to the other pane leaves the first and focuses the second", () => {
  const split = splitPane(openTab(openTab(emptyLayout(), A), B), "pane-1", "row", "pane-2");
  const moved = moveTab(split, { paneId: "pane-1", index: 0 }, "pane-2");

  assert.deepEqual(labels(moved), ["b", "b,a"]);
  assert.equal(moved.focusedPaneId, "pane-2");
});

test("moving a tab onto its own pane just activates it", () => {
  const layout = openTab(openTab(emptyLayout(), A), B);
  const moved = moveTab(layout, { paneId: "pane-1", index: 0 }, "pane-1");

  assert.deepEqual(labels(moved), ["a,b"]);
  assert.deepEqual(activeTab(leaves(moved.root)[0]!), A);
});

test("moving a tab that is not there changes nothing", () => {
  const before = openTab(emptyLayout(), A);
  assert.equal(moveTab(before, { paneId: "pane-1", index: 7 }, "pane-1"), before);
});

test("the ratio survives a round trip and never lets a side vanish", () => {
  const layout = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");
  const split = layout.root as PaneSplit;

  assert.equal((setRatio(layout, split, 0.72).root as PaneSplit).ratio, 0.72);
  assert.equal((setRatio(layout, split, 0).root as PaneSplit).ratio, 0.1);
  assert.equal((setRatio(layout, split, 5).root as PaneSplit).ratio, 0.9);
});

test("focus only moves to a pane that exists", () => {
  const layout = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");

  assert.equal(focusPane(layout, "pane-1").focusedPaneId, "pane-1");
  assert.equal(focusPane(layout, "pane-gone").focusedPaneId, "pane-2");
});

test("a tab whose entity was deleted elsewhere is dropped, not rendered broken", () => {
  const split = splitPane(openTab(openTab(emptyLayout(), A), B), "pane-1", "row", "pane-2");
  const pruned = pruneLayout(split, (tab) => tab.id !== "b");

  assert.equal(pruned.root.type, "leaf");
  assert.deepEqual(labels(pruned), ["a"]);
});

test("pruning everything leaves one empty pane rather than no workspace", () => {
  const split = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");
  const pruned = pruneLayout(split, () => false);

  assert.equal(pruned.root.type, "leaf");
  assert.deepEqual(labels(pruned), [""]);
  assert.equal(pruned.focusedPaneId, leaves(pruned.root)[0]!.id);
});

test("pruning clamps an active index that pointed past the survivors", () => {
  let layout = openTab(openTab(emptyLayout(), A), B);
  layout = activateTab(layout, "pane-1", 1);

  const pruned = pruneLayout(layout, (tab) => tab.id === "a");
  assert.deepEqual(activeTab(leaves(pruned.root)[0]!), A);
});

/* -------------------------------------------------------------------------
 * Which document is "on", and its mode (D3, §3.9)
 * ---------------------------------------------------------------------- */

test("the active key is the focused pane's active tab, not the leftmost tab", () => {
  let layout = openTab(openTab(emptyLayout(), A), B);
  layout = openTab(layout, A);
  layout = activateTab(layout, "pane-1", 1);

  assert.equal(activeTabKey(layout), "vault_page:b");
  assert.deepEqual(activeTabRef(layout), B);
});

test("the active key follows the focused pane across a split", () => {
  const layout = splitPane(openTab(openTab(emptyLayout(), A), B), "pane-1", "row", "pane-2");

  // The split carried the pane's active tab across and focused the new pane.
  assert.equal(layout.focusedPaneId, "pane-2");
  assert.equal(activeTabKey(layout), "vault_page:b");

  const back = focusPane(layout, "pane-1");
  assert.equal(activeTabKey(back), "vault_page:b", "pane-1 still has its own active tab");
  assert.equal(activeTabKey(activateTab(back, "pane-1", 0)), "vault_page:a");
});

test("a layout with nothing open has no active key rather than an empty one", () => {
  assert.equal(activeTabKey(emptyLayout()), undefined);
  assert.equal(activeTabRef(emptyLayout()), undefined);
});

test("closing the only tab of the focused pane falls back to the pane that is left", () => {
  const layout = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");
  const emptied = closeTab(layout, "pane-2", 0);
  assert.equal(activeTabKey(emptied), "vault_page:a");
});

test("a tab that predates modes reads as Edit, which is what it was", () => {
  assert.equal(tabMode(A), "edit");
  assert.equal(tabMode({ kind: "ink_page", id: "i" }), "ink");
});

test("hydrateTabModes stamps the opening mode on tabs that were never switched", () => {
  const layout = openTab(openTab(emptyLayout(), A), B);
  const next = hydrateTabModes(layout, (tab) => (tab.id === "a" ? "read" : "edit"));

  const tabs = leaves(next.root)[0]!.tabs;
  assert.equal(tabs[0]!.mode, "read");
  assert.equal(tabs[1]!.mode, "edit");
});

test("hydrateTabModes leaves a mode the user chose alone", () => {
  // Switched to Edit by hand last session: that is a decision, and a reload
  // must not quietly undo it back to the document's opening mode.
  const chosen = setTabMode(openTab(emptyLayout(), A), A, "edit");
  const next = hydrateTabModes(chosen, () => "read");

  assert.equal(leaves(next.root)[0]!.tabs[0]!.mode, "edit");
});

test("hydrateTabModes returns the same layout when there is nothing to stamp", () => {
  const layout = setTabMode(openTab(emptyLayout(), A), A, "read");
  assert.equal(hydrateTabModes(layout, () => "edit"), layout);
});

test("setMode touches only the addressed tab", () => {
  const layout = openTab(openTab(emptyLayout(), A), B);
  const next = setTabMode(layout, A, "read");

  assert.equal(tabMode(leaves(next.root)[0]!.tabs[0]!), "read");
  assert.equal(tabMode(leaves(next.root)[0]!.tabs[1]!), "edit");
});

test("a mode belongs to the document, so it applies in every pane showing it", () => {
  const layout = splitPane(openTab(emptyLayout(), A), "pane-1", "row", "pane-2");
  const next = setTabMode(layout, A, "read");

  for (const leaf of leaves(next.root)) {
    assert.equal(tabMode(leaf.tabs[0]!), "read");
  }
});

test("toggling by position flips and flips back, reading the live mode", () => {
  const layout = openTab(emptyLayout(), A);
  const read = toggleTabModeAt(layout, "pane-1", 0);
  assert.equal(tabMode(leaves(read.root)[0]!.tabs[0]!), "read");

  // The second press is the one that matters: addressing by a `TabRef` captured
  // at render time would re-read `edit` and do nothing.
  const edit = toggleTabModeAt(read, "pane-1", 0);
  assert.equal(tabMode(leaves(edit.root)[0]!.tabs[0]!), "edit");
});

test("toggling a position that is not there changes nothing", () => {
  const layout = openTab(emptyLayout(), A);
  assert.equal(toggleTabModeAt(layout, "pane-1", 7), layout);
  assert.equal(toggleTabModeAt(layout, "pane-gone", 0), layout);
});

test("setting the mode a document is already in returns the same layout", () => {
  // Read once, so the mode is on the tab rather than merely implied by the
  // default — a second call for the same mode is then a genuine no-op.
  const layout = setTabMode(openTab(emptyLayout(), A), A, "read");
  assert.equal(setTabMode(layout, A, "read"), layout);
});

test("choosing Edit on a default tab records the choice", () => {
  // `tabMode` reads a mode-less tab as Edit, but nobody has chosen that yet: it
  // has to be written down, or an opening mode would override the choice on the
  // next load and the Edit button would look dead.
  const layout = openTab(emptyLayout(), A);
  const chosen = setTabMode(layout, A, "edit");
  assert.notEqual(chosen, layout);
  assert.equal(leaves(chosen.root)[0]!.tabs[0]!.mode, "edit");
  // And it is idempotent from there.
  assert.equal(setTabMode(chosen, A, "edit"), chosen);
});

test("setting a mode on a tab that is not open changes nothing", () => {
  const layout = openTab(emptyLayout(), A);
  assert.equal(setTabMode(layout, B, "read"), layout);
});

test("the mode survives closing and reopening the same document", () => {
  const opened = setTabMode(openTab(emptyLayout(), A), A, "read");
  const closed = closeTab(opened, "pane-1", 0);
  const reopened = openTab(closed, tabAt(opened, "pane-1", 0)!);
  assert.equal(tabMode(leaves(reopened.root)[0]!.tabs[0]!), "read");
});
