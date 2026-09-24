import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { kindMeta, isDocumentKind, documentKind } from "../ui/kind";
import { buildWorkspaceTree, flattenTree } from "../application/workspace-tree";

/**
 * Every document kind the tree can show must also be one the pane can edit.
 *
 * This started as a real bug: log entries were in `kind.ts`'s table, rendered as
 * text, and had no writer in the workspace's save path — so the logbook was the
 * one kind of markdown in the app you could not open in the editor. The kind
 * table is a table; a kind that is a document but has no writer is a row that
 * silently does nothing when you type in it, and nothing catches that at compile
 * time because the writers are a `Record<string, …>`.
 *
 * A read of the source rather than a mounted component, deliberately: this is a
 * statement about the wiring (`kind.ts`'s document kinds against the save path's
 * keys), and mounting the whole workspace to assert it would be a slower, more
 * brittle way to say the same thing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(path.join(here, "..", "ui", "workspace-screen.tsx"), "utf8");

/** The kinds the save path has a writer for — the keys of its `writers` map. */
function writerKinds(): string[] {
  const start = screen.indexOf("const writers:");
  assert.ok(start >= 0, "the workspace screen has no writers map");
  const end = screen.indexOf("};", start);
  const body = screen.slice(start, end);
  return [...body.matchAll(/^\s{10}([a-z_]+):/gm)].map((match) => match[1]!);
}

/**
 * Every kind the Files section can show has a writer.
 *
 * The roots the tree actually builds, not every row in the kind table: a
 * `reading_list` is a document row by the table's own answer — a tab can point
 * at it and it can be counted — but its markdown is written by the Lists screen,
 * which owns naming, nesting and membership, and it never appears as a row under
 * Files. Files is the set this asserts.
 */
test("every kind the Files tree shows as a document has an editor writer", () => {
  const writers = new Set(writerKinds());
  const tree = buildWorkspaceTree({
    notes: [{ id: "n1", title: "A note" }],
    papers: [{ id: "p1", title: "A paper", hasNote: true }],
    reportSections: [{ id: "s1", title: "A section" }],
    logEntries: [{ id: "l1", entryDate: "2026-03-14" }],
  });
  const shown = new Set(flattenTree(tree).map((node) => node.kind));
  for (const kind of shown) {
    if (!isDocumentKind(kind)) continue;
    if (documentKind(kind) !== "text") continue;
    assert.ok(
      writers.has(kind),
      `"${kind}" is a text document in the Files tree with no writer in the save path`,
    );
  }
  // And the logbook really is in there: the regression this file was written for.
  assert.equal(shown.has("log_entry"), true);
});

test("a log entry is a text document, and is in the tree", () => {
  assert.equal(isDocumentKind("log_entry"), true);
  assert.equal(documentKind("log_entry"), "text");
  assert.equal(kindMeta("log_entry").suffix, ".log.md");
  // And it is reachable: a tree built with one has a row for it.
  const tree = buildWorkspaceTree({
    notes: [],
    papers: [],
    reportSections: [],
    logEntries: [{ id: "l1", entryDate: "2026-03-14" }],
  });
  const rows = flattenTree(tree).filter((node) => node.kind === "log_entry");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.path, "logbook/2026/03/2026-03-14--l1.log.md");
});
