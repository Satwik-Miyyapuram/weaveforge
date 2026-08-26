import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EXPANDED,
  EXPLORER_STORAGE_KEY,
  readExpanded,
  toggleExpanded,
  writeExpanded,
} from "../application/explorer-state";
import { buildWorkspaceTree, visibleRows } from "../application/workspace-tree";

function memoryStore(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

test("a first run opens the roots rather than showing an empty panel", () => {
  assert.deepEqual([...readExpanded(memoryStore())], [...DEFAULT_EXPANDED]);
  assert.deepEqual([...readExpanded(undefined)], [...DEFAULT_EXPANDED]);
});

test("what was expanded survives a reload", () => {
  const store = memoryStore();
  writeExpanded(store, new Set(["notes", "vault_page:a"]));

  assert.deepEqual([...readExpanded(store)], ["notes", "vault_page:a"]);
  assert.equal(store.read(), JSON.stringify(["notes", "vault_page:a"]));
});

test("collapsing everything is remembered, not treated as no record", () => {
  const store = memoryStore();
  writeExpanded(store, new Set());

  assert.deepEqual([...readExpanded(store)], []);
});

test("a record written by something else falls back to the defaults", () => {
  assert.deepEqual([...readExpanded(memoryStore("not json"))], [...DEFAULT_EXPANDED]);
  assert.deepEqual([...readExpanded(memoryStore('{"notes":true}'))], [...DEFAULT_EXPANDED]);
  assert.deepEqual([...readExpanded(memoryStore("[1, \"notes\"]"))], ["notes"]);
});

test("storage that throws never stops the explorer", () => {
  const hostile = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };

  assert.deepEqual([...readExpanded(hostile)], [...DEFAULT_EXPANDED]);
  assert.doesNotThrow(() => writeExpanded(hostile, ["notes"]));
  assert.equal(EXPLORER_STORAGE_KEY, "weaveforge.explorer.expanded");
});

test("toggling is a new set, so React sees the change", () => {
  const before = new Set(["notes"]);
  const opened = toggleExpanded(before, "papers");
  const closed = toggleExpanded(opened, "notes");

  assert.deepEqual([...before], ["notes"]);
  assert.deepEqual([...opened].sort(), ["notes", "papers"]);
  assert.deepEqual([...closed], ["papers"]);
});

test("only the open rows are painted, and each knows its indent", () => {
  const tree = buildWorkspaceTree({
    notes: [
      { id: "a", title: "Method" },
      { id: "b", title: "Baselines", parentId: "a" },
    ],
    papers: [],
    reportSections: [],
  });

  const collapsedNote = visibleRows(tree, new Set(["notes", "papers", "report"]));
  assert.deepEqual(
    collapsedNote.map((row) => [row.node.label, row.depth]),
    [
      ["Notes", 0],
      ["Method", 1],
      ["Papers", 0],
      ["Report", 0],
    ],
  );

  const openNote = visibleRows(tree, new Set(["notes", "vault_page:a"]));
  assert.deepEqual(
    openNote.map((row) => [row.node.label, row.depth]),
    [
      ["Notes", 0],
      ["Method", 1],
      ["Baselines", 2],
      ["Papers", 0],
      ["Report", 0],
    ],
  );
});
