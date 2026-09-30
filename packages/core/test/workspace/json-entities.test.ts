import assert from "node:assert/strict";
import test from "node:test";
import {
  addCounts,
  diffJsonData,
  isAppOwnedPath,
  jsonDataPath,
  jsonKindOfPath,
  parseJsonData,
  projectDir,
} from "../../src/index.js";

/**
 * The project's JSON data files, which are two-way like the markdown.
 *
 * What these pin: only the app's own machinery is skipped, the three data files
 * are not; a file that cannot be read says nothing rather than "empty"; and the
 * by-id rules are the markdown import's, including the removal a file expresses
 * by no longer listing a row.
 */
const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const ROOT = projectDir(PROJECT);

test("the three data files are the reader's, the machinery is not", () => {
  const data = [
    `${ROOT}/.weaveforge/relations.json`,
    `${ROOT}/.weaveforge/tags.json`,
    `${ROOT}/.weaveforge/reading-list-items.json`,
  ];
  for (const path of data) assert.equal(isAppOwnedPath(path), false, path);

  const machinery = [
    `${ROOT}/.weaveforge/db/PG_VERSION`,
    `.weaveforge/db/postgresql.conf`,
    `${ROOT}/.weaveforge/db-backups/local-db-2026-09-29.tar.gz`,
    `${ROOT}/.weaveforge/cache/pdf-text/x.json`,
    `.weaveforge/cache/pdf-text/x.json`,
    `${ROOT}/.weaveforge/mirror.json`,
    `.weaveforge/mirror.json`,
    `${ROOT}/.weaveforge/manifest.json`,
    `${ROOT}/.weaveforge/db-relocated`,
  ];
  for (const path of machinery) assert.equal(isAppOwnedPath(path), true, path);
});

test("a path names one of the three kinds, or none", () => {
  assert.equal(jsonKindOfPath(`${ROOT}/.weaveforge/relations.json`), "relations");
  assert.equal(jsonKindOfPath(`${ROOT}/.weaveforge/tags.json`), "tags");
  assert.equal(jsonKindOfPath(`${ROOT}/.weaveforge/reading-list-items.json`), "reading_list_items");
  // The manifest is data about the mirror, not data to import.
  assert.equal(jsonKindOfPath(`${ROOT}/.weaveforge/mirror.json`), null);
  assert.equal(jsonKindOfPath(`${ROOT}/notes/a.note.md`), null);
  assert.equal(jsonDataPath(ROOT, "relations"), `${ROOT}/.weaveforge/relations.json`);
});

test("an unreadable file says nothing rather than nothing is left", () => {
  // A truncated write, a file of another shape, a `.json` from somewhere else:
  // reading any of them as "no rows" would turn a syntax error into a deletion.
  assert.equal(parseJsonData("p", '{"not":"an array"}', "relations"), null);
  assert.equal(parseJsonData("p", '[{"id": ', "relations"), null);
  assert.equal(parseJsonData("p", "not json at all", "relations"), null);

  const parsed = parseJsonData("p", '[{"id":"r1"},{"noId":true},{"id":""},{"id":"r2"}]', "relations");
  assert.deepEqual(parsed?.rows.map((row) => row.id), ["r1", "r2"]);
});

test("an id nothing has is a creation, and a matching row is unchanged", () => {
  const parsed = parseJsonData("p", '[{"id":"r1","fromPaper":"a","toPaper":"b"}]', "relations");
  assert.ok(parsed);

  const created = diffJsonData(parsed, []);
  assert.equal(created.counts.created, 1);
  assert.equal(created.entries[0]!.action, "created");

  const unchanged = diffJsonData(parsed, [{ id: "r1", fromPaper: "a", toPaper: "b" }]);
  assert.equal(unchanged.counts.unchanged, 1);
});

test("which side moved decides between an update, silence and a conflict", () => {
  const parsed = parseJsonData("p", '[{"id":"r1","note":"the folder version"}]', "relations");
  assert.ok(parsed);
  const stored = [{ id: "r1", note: "the workspace version" }];

  // The folder moved it: apply it.
  const fromFolder = diffJsonData(parsed, stored, { origin: () => "folder" });
  assert.equal(fromFolder.counts.updated, 1);

  // The workspace moved it: the folder's copy is the stale one.
  const fromWorkspace = diffJsonData(parsed, stored, { origin: () => "workspace" });
  assert.equal(fromWorkspace.counts.unchanged, 1);
  assert.equal(fromWorkspace.counts.updated, 0);

  // Both moved it: ask, never guess.
  const both = diffJsonData(parsed, stored, { origin: () => "both" });
  assert.equal(both.counts.conflict, 1);
  assert.equal(both.entries[0]!.conflictKind, "both-changed");

  // No manifest to consult — an older folder, another machine: the reader judges.
  assert.equal(diffJsonData(parsed, stored).counts.updated, 1);
});

test("a row the file stopped listing is a removal, reported and not applied", () => {
  const parsed = parseJsonData("p", '[{"id":"r1"}]', "relations");
  assert.ok(parsed);

  const diff = diffJsonData(parsed, [{ id: "r1" }, { id: "gone" }]);
  assert.equal(diff.counts.removed, 1);
  assert.equal(diff.entries.find((entry) => entry.action === "removed")!.existing.id, "gone");
});

test("counts add up across the two halves of one preview", () => {
  const a = { created: 1, updated: 0, unchanged: 2, conflict: 0, removed: 0 };
  const b = { created: 0, updated: 1, unchanged: 0, conflict: 1, removed: 3 };
  assert.deepEqual(addCounts(a, b), {
    created: 1,
    updated: 1,
    unchanged: 2,
    conflict: 1,
    removed: 3,
  });
});
