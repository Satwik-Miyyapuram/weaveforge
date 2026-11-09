/** Tab groups: named, coloured runs of tabs in one strip that fold away. */
import assert from "node:assert/strict";
import test from "node:test";
import type { PaneLayout, PaneLeaf, TabRef } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";
import { readLayout, writeLayout } from "../application/layout-storage";

const tab = (id: string): TabRef => ({ kind: "vault_page", id });
const ABCD = ["a", "b", "c", "d"].reduce((layout, id) => readyCore().openTab(layout, tab(id)), readyCore().emptyLayout());
const leaf = (layout: PaneLayout, pane = 0): PaneLeaf => readyCore().leaves(layout.root)[pane]!;
const ids = (layout: PaneLayout) => leaf(layout).tabs.map((t) => t.id);
const groupOf = (layout: PaneLayout) => leaf(layout).tabs.map((t) => t.group ?? "-");
const run = (layout: PaneLayout, index: number, command: Parameters<ReturnType<typeof readyCore>["layoutForTabMenu"]>[3]) =>
  readyCore().layoutForTabMenu(layout, "pane-1", index, command);

test("a new group holds the clicked tab and gets the next colour", () => {
  const one = run(ABCD, 1, { group: "new" });
  assert.deepEqual(groupOf(one), ["-", "g1", "-", "-"]);
  assert.deepEqual(leaf(one).groups, [{ id: "g1", name: "", color: 1 }]);

  const two = run(one, 3, { group: "new" });
  assert.deepEqual(groupOf(two), ["-", "g1", "-", "g2"]);
  assert.equal(leaf(two).groups![1]!.color, 2);
});

test("joining a group moves the tab next to the group's last tab", () => {
  const grouped = run(ABCD, 0, { group: "new" });
  const joined = run(grouped, 3, { group: "join", id: "g1" });
  assert.deepEqual(ids(joined), ["a", "d", "b", "c"]);
  assert.deepEqual(groupOf(joined), ["g1", "g1", "-", "-"]);
});

test("leaving a group puts the tab just after it, and an empty group is dropped", () => {
  let layout = run(ABCD, 0, { group: "new" });
  layout = run(layout, 1, { group: "join", id: "g1" });
  const left = run(layout, 0, { group: "leave" });
  assert.deepEqual(ids(left), ["b", "a", "c", "d"]);
  assert.deepEqual(groupOf(left), ["g1", "-", "-", "-"]);

  const gone = run(left, 0, { group: "leave" });
  assert.deepEqual(groupOf(gone), ["-", "-", "-", "-"]);
  assert.deepEqual(leaf(gone).groups, []);
});

test("rename, recolour and ungroup-all act on the clicked tab's group", () => {
  let layout = run(ABCD, 0, { group: "new" });
  layout = run(layout, 1, { group: "join", id: "g1" });
  layout = run(layout, 0, { group: "rename", name: "  Methods " });
  layout = run(layout, 0, { group: "color", color: 4 });
  assert.deepEqual(leaf(layout).groups, [{ id: "g1", name: "Methods", color: 4 }]);

  const dissolved = run(layout, 1, { group: "dissolve" });
  assert.deepEqual(groupOf(dissolved), ["-", "-", "-", "-"]);
  assert.deepEqual(ids(dissolved), ["a", "b", "c", "d"]);
});

test("a group command on an ungrouped tab changes nothing", () => {
  assert.equal(run(ABCD, 0, { group: "toggle" }), ABCD);
  assert.equal(run(ABCD, 0, { group: "join", id: "nope" }), ABCD);
});

test("a folded group hides its tabs, except the open one, behind one chip", () => {
  let layout = run(ABCD, 0, { group: "new" });
  layout = run(layout, 1, { group: "join", id: "g1" });
  const folded = run(layout, 0, { group: "toggle" });
  // `d` is the open tab, outside the group.
  const runs = readyCore().groupRuns(leaf(folded));
  assert.deepEqual(
    runs.map((r) => [r.chip?.id ?? null, r.hidden]),
    [["g1", true], [null, true], [null, false], [null, false]],
  );
  assert.equal(runs[0]!.size, 2);

  const opened = run(folded, 0, { group: "toggle" });
  assert.deepEqual(readyCore().groupRuns(leaf(opened)).map((r) => r.hidden), [false, false, false, false]);
});

test("the open tab of a folded group stays visible", () => {
  let layout = run(ABCD, 2, { group: "new" });
  layout = run(layout, 3, { group: "join", id: "g1" });
  const folded = run(layout, 2, { group: "toggle" });
  assert.deepEqual(readyCore().groupRuns(leaf(folded)).map((r) => r.hidden), [false, false, true, false]);
});

test("a tab carried to another pane leaves its group behind", () => {
  const grouped = run(ABCD, 0, { group: "new" });
  const split = readyCore().splitPane(grouped, "pane-1", "row", "pane-2");
  const moved = readyCore().moveTab(split, { paneId: "pane-1", index: 0 }, "pane-2");
  for (const pane of readyCore().leaves(moved.root)) for (const t of pane.tabs) assert.equal(t.group, undefined, pane.id);
  assert.deepEqual(readyCore().withoutGroup({ kind: "k", id: "i", mode: "ink", group: "g1" }), { kind: "k", id: "i", mode: "ink" });
});

test("a tab naming a group that is not there reads as ungrouped", () => {
  const stale: PaneLeaf = { type: "leaf", id: "p", tabs: [{ ...tab("a"), group: "gone" }], activeIndex: 0 };
  assert.deepEqual(readyCore().groupRuns(stale), [{ chip: null, hidden: false, size: 0 }]);
});

test("groups survive a restart; junk group records are dropped", () => {
  let layout = run(ABCD, 0, { group: "new" });
  layout = run(layout, 0, { group: "rename", name: "Lit" });
  layout = run(layout, 0, { group: "toggle" });
  const store = { value: "", getItem: () => store.value, setItem: (_k: string, v: string) => void (store.value = v) };
  writeLayout(store, layout);
  const restored = leaf(readLayout(store));
  assert.deepEqual(restored.groups, [{ id: "g1", name: "Lit", color: 1, collapsed: true }]);
  assert.equal(restored.tabs[0]!.group, "g1");

  const junk = JSON.stringify({
    root: {
      type: "leaf",
      id: "pane-1",
      activeIndex: 0,
      tabs: [{ kind: "k", id: "x", group: "g9" }, { kind: "k", id: "y", group: 5 }],
      groups: [{ id: "g1", name: "Empty", color: 2 }, { id: 3 }, "nope"],
    },
  });
  const cleaned = leaf(readLayout({ getItem: () => junk, setItem: () => {} }));
  assert.deepEqual(cleaned.groups, []);
  assert.deepEqual(cleaned.tabs.map((t) => t.group), [undefined, undefined]);
});
