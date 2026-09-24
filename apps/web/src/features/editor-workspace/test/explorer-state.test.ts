import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPLORER_STORAGE_KEY,
  collapseAll,
  defaultExpanded,
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

/**
 * The roots a workspace with one of everything has.
 *
 * Derived from the tree rather than written out, because the bug this file now
 * guards against was a written-out list: `DEFAULT_EXPANDED` named three roots
 * and the tree had four, so the logbook was the one section a first run left
 * shut. A test that spells the four keys by hand would have had the same gap.
 */
const ROOTS = buildWorkspaceTree({
  notes: [],
  papers: [],
  reportSections: [],
  logEntries: [],
}).map((node) => node.key);

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
  assert.deepEqual([...readExpanded(memoryStore(), ROOTS)], [...defaultExpanded(ROOTS)]);
  assert.deepEqual([...readExpanded(undefined, ROOTS)], [...defaultExpanded(ROOTS)]);
  // Including the logbook, which the old hard-coded default left shut.
  assert.ok(ROOTS.includes("logbook"), "the tree no longer has a Log root");
});

test("what was expanded survives a reload", () => {
  const store = memoryStore();
  // A record that already knows every root: what it says is what comes back,
  // with nothing added.
  writeExpanded(store, new Set(["notes", "vault_page:a", ...ROOTS]));

  const reopened = readExpanded(store, ROOTS, true);
  assert.deepEqual([...reopened], ["notes", "vault_page:a", "papers", "report", "logbook"]);
  // Including the fact that a root the reader left shut is not reopened.
  assert.equal(reopened.has("logbook"), true);
});

/**
 * A record written before a root existed does not keep it shut.
 *
 * This is the case the "start open" rule missed for every existing reader: the
 * stored list is a delta against the roots of the day it was written, nothing
 * rewrites it when a root appears, and so the new root stayed collapsed for
 * everyone who had ever toggled a folder — which is everyone.
 */
test("a root the record has never heard of is opened, on the migrating read", () => {
  const store = memoryStore();
  // Exactly the shape a pre-logbook record has.
  writeExpanded(store, new Set(["notes", "papers", "report"]));

  assert.deepEqual([...readExpanded(store, ROOTS, true)], ["notes", "papers", "report", "logbook"]);
});

/**
 * And the read after it leaves the record alone.
 *
 * The migration cannot tell "this record predates the root" from "the reader
 * closed this root" — a collapse and an absence are the same absent key — so
 * running it on every read reopens every section anybody ever closed. That is
 * the bug this pins: collapse the Log, reload, and it came back.
 */
test("a deliberate collapse is not a migration, and survives the next read", () => {
  const store = memoryStore();
  // Migrated once, which is what a real session does on its first read.
  const migrated = readExpanded(
    (() => {
      writeExpanded(store, new Set(["notes", "papers", "report"]));
      return store;
    })(),
    ROOTS,
    true,
  );
  assert.equal(migrated.has("logbook"), true);

  // The reader closes the Log, and that is written back.
  const collapsed = new Set(migrated);
  collapsed.delete("logbook");
  writeExpanded(store, collapsed);

  // The next session's read does not migrate, and does not reopen it.
  assert.equal(readExpanded(store, ROOTS, false).has("logbook"), false);
  // Asking the migration to run again *would* reopen it, and that is exactly
  // why the caller runs it once: a collapse and a record that predates the root
  // are the same absent key, so nothing in the record can tell them apart. This
  // assertion is the reason `readExpanded` takes a `migrate` flag at all.
  assert.equal(readExpanded(store, ROOTS, true).has("logbook"), true);
});

test("collapsing everything is remembered, not treated as no record", () => {
  const store = memoryStore();
  writeExpanded(store, new Set());

  // An empty record is a decision — "I collapsed everything" — and the
  // migration must not undo it by filling in every root.
  assert.deepEqual([...readExpanded(store, ROOTS, true)], []);
});

test("a record written by something else falls back to the defaults", () => {
  assert.deepEqual([...readExpanded(memoryStore("not json"), ROOTS)], [...defaultExpanded(ROOTS)]);
  assert.deepEqual([...readExpanded(memoryStore('{"notes":true}'), ROOTS)], [...defaultExpanded(ROOTS)]);
  // A valid array with unknown keys keeps what it names and gains the roots the
  // tree has — the migration is what the `true` asks for.
  assert.deepEqual(
    [...readExpanded(memoryStore("[1, \"notes\"]"), ROOTS, true)].sort(),
    [...new Set(["notes", ...ROOTS])].sort(),
  );
  // Without it, the record is taken exactly as written.
  assert.deepEqual([...readExpanded(memoryStore("[1, \"notes\"]"), ROOTS)], ["notes"]);
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

  assert.deepEqual([...readExpanded(hostile, ROOTS)], [...defaultExpanded(ROOTS)]);
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
      ["Log", 0],
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
      ["Log", 0],
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
    ["Notes", "Papers", "Report", "Log"],
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
    kept.filter((row) => row.node.kind === "paper").map((row) => row.node.title),
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
