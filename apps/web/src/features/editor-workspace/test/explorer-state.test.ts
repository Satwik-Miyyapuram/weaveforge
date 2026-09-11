import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EXPANDED,
  EXPLORER_STORAGE_KEY,
  collapseAll,
  expandAll,
  isSectionOpen,
  readExpanded,
  readSections,
  toggleExpanded,
  toggleSection,
  writeExpanded,
  type ExplorerSection,
} from "../application/explorer-state";
import {
  buildWorkspaceTree,
  filterRows,
  visibleRows,
  type WorkspaceTreeNode,
} from "../application/workspace-tree";

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

/* -------------------------------------------------------------------------
 * Sections and the filter (§3.1, §3.5)
 * ---------------------------------------------------------------------- */

const SECTIONS: ExplorerSection[] = [
  { id: "files", title: "Files", tree: [] },
  { id: "lists", title: "Reading lists", tree: [] },
  { id: "outline", title: "Outline", tree: [], collapsedByDefault: true },
];

function nestedTree(): WorkspaceTreeNode[] {
  return buildWorkspaceTree({
    notes: [
      { id: "c", title: "Baselines", parentId: "b" },
      { id: "b", title: "Chapter two", parentId: "a" },
      { id: "a", title: "Thesis" },
      { id: "d", title: "Loose note" },
    ],
    papers: [{ id: "p1", title: "β-VAE", hasNote: true }],
    reportSections: [],
  });
}

test("collapse all closes every branch", () => {
  const opened = expandAll(nestedTree());
  assert.ok(opened.size > 0);
  assert.equal(collapseAll().size, 0);
});

test("collapse all leaves one row per root and nothing else", () => {
  assert.deepEqual(
    visibleRows(nestedTree(), collapseAll()).map((row) => row.node.label),
    ["Notes", "Papers", "Report"],
  );
});

test("expand all opens every branch that has children", () => {
  const rows = visibleRows(nestedTree(), expandAll(nestedTree()));
  assert.ok(rows.some((row) => row.node.label === "Baselines"));
  assert.ok(rows.some((row) => row.node.label === "β-VAE"));
});

test("the filter keeps a match, its ancestors and its subtree", () => {
  const rows = visibleRows(nestedTree(), expandAll(nestedTree()));
  const { rows: kept, expand } = filterRows(rows, "Baselines");
  const labels = kept.map((row) => row.node.label);

  assert.ok(labels.includes("Baselines"));
  assert.ok(labels.includes("Notes"), "the root above the match must stay");
  assert.equal(labels.includes("β-VAE"), false);
  assert.ok(expand.has("notes"));
});

test("the filter matches the mirrored path as well as the label", () => {
  const rows = visibleRows(nestedTree(), expandAll(nestedTree()));
  const { rows: kept } = filterRows(rows, ".paper.md");
  assert.deepEqual(
    kept.filter((row) => row.node.kind === "paper").map((row) => row.node.label),
    ["β-VAE"],
  );
});

test("an empty query returns the visible rows and opens nothing", () => {
  const rows = visibleRows(nestedTree(), new Set(["notes"]));
  const result = filterRows(rows, "   ");
  assert.equal(result.rows.length, rows.length);
  assert.equal(result.expand.size, 0);
});

test("a filter that matches nothing paints nothing", () => {
  const rows = visibleRows(nestedTree(), expandAll(nestedTree()));
  assert.equal(filterRows(rows, "zzzz").rows.length, 0);
});

test("sections default from their own declaration, not one global flag", () => {
  const state = readSections(undefined, SECTIONS);
  assert.equal(isSectionOpen(state, "files"), true);
  assert.equal(isSectionOpen(state, "lists"), true);
  assert.equal(isSectionOpen(state, "outline"), false);
});

test("collapsing one section leaves the others exactly as they were", () => {
  const before = readSections(undefined, SECTIONS);
  const after = toggleSection(before, "lists");
  assert.equal(isSectionOpen(after, "lists"), false);
  assert.equal(isSectionOpen(after, "files"), true);
  assert.equal(isSectionOpen(after, "outline"), false);
});

test("toggling a section twice puts it back", () => {
  const before = readSections(undefined, SECTIONS);
  const after = toggleSection(toggleSection(before, "files"), "files");
  assert.equal(isSectionOpen(after, "files"), true);
});

test("a stored section list wins over the defaults", () => {
  const state = readSections(memoryStore(JSON.stringify(["outline"])), SECTIONS);
  assert.equal(isSectionOpen(state, "outline"), true);
  assert.equal(isSectionOpen(state, "files"), false);
});

test("a malformed stored section list falls back to the defaults", () => {
  const state = readSections(memoryStore("not json"), SECTIONS);
  assert.equal(isSectionOpen(state, "files"), true);
});
