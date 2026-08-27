import assert from "node:assert/strict";
import { test } from "node:test";
import { digestText, type ImportDiffEntry } from "@weaveforge/core";

import {
  keepBothTitle,
  mergeBothChanged,
  settleConflict,
} from "../application/workspace-folder";

const conflict: ImportDiffEntry = {
  action: "conflict",
  kind: "both-changed",
  entity: {
    id: "n1",
    type: "vault_page",
    title: "Both of us edited this",
    body: "the folder's copy",
    path: "notes/n1.note.md",
    fields: {},
  },
};

test("an unsettled conflict is left alone", () => {
  assert.equal(settleConflict(conflict, {}), null);
  assert.equal(settleConflict(conflict, { "notes/n1.note.md": "keep" }), null);
  // Somebody else's conflict being settled does not settle this one.
  assert.equal(settleConflict(conflict, { "notes/other.note.md": "folder" }), null);
});

test("taking the folder's copy is an update to the same note", () => {
  const settled = settleConflict(conflict, { "notes/n1.note.md": "folder" });
  assert.equal(settled?.action, "updated");
  assert.equal(settled?.entity.id, "n1");
  assert.equal(settled?.entity.title, "Both of us edited this");
});

test("keeping both creates a note and never touches the existing one", () => {
  const settled = settleConflict(conflict, { "notes/n1.note.md": "both" });
  assert.equal(settled?.action, "created");
  // The id is dropped, which is what stops the import writing over the very
  // note the user asked to keep.
  assert.equal(settled?.entity.id, undefined);
  assert.equal(settled?.entity.title, keepBothTitle("Both of us edited this"));
  assert.equal(settled?.entity.body, "the folder's copy");
});

test("a type mismatch cannot be overwritten, whatever was asked", () => {
  const mismatch: ImportDiffEntry = { ...conflict, kind: "type-mismatch" };
  const settled = settleConflict(mismatch, { "notes/n1.note.md": "folder" });
  // There is no note behind that id to update, so the only safe reading of
  // "take the folder's copy" is to import it as something new.
  assert.equal(settled?.action, "created");
  assert.equal(settled?.entity.id, undefined);
});

test("a type mismatch left alone is still left alone", () => {
  const mismatch: ImportDiffEntry = { ...conflict, kind: "type-mismatch" };
  assert.equal(settleConflict(mismatch, {}), null);
});

test("entries that are not conflicts pass through untouched", () => {
  const update: ImportDiffEntry = { action: "updated", entity: conflict.entity };
  assert.equal(settleConflict(update, { "notes/n1.note.md": "both" }), update);
});

const noteContent = (fields: string, body: string, title = "Shared note") =>
  `---\nweaveforge-id: n1\nweaveforge-type: vault_page\ntitle: ${title}\n${fields}---\n\n${body}\n`;

const bothChanged: ImportDiffEntry = {
  action: "conflict",
  kind: "both-changed",
  reason: "notes/n1.note.md changed both in the folder and in the workspace.",
  entity: {
    id: "n1",
    type: "vault_page",
    title: "Shared note",
    body: "the original body",
    path: "notes/n1.note.md",
    fields: { tags: ["a", "b"] },
  },
};

const base = { fields: { title: "Shared note", tags: ["a"] }, bodyDigest: digestText("the original body") };

test("edits that do not collide are merged instead of asked about", () => {
  const merged = mergeBothChanged(
    bothChanged,
    base,
    noteContent("tags:\n  - a\n", "a body rewritten in the app"),
  );

  assert.equal(merged.action, "updated");
  assert.equal(merged.kind, undefined);
  assert.equal(merged.entity.body.trim(), "a body rewritten in the app");
  assert.deepEqual(merged.entity.fields.tags, ["a", "b"]);
});

test("a body both sides rewrote stays a conflict, and says so", () => {
  const merged = mergeBothChanged(
    bothChanged,
    { ...base, bodyDigest: digestText("something else entirely") },
    noteContent("tags:\n  - a\n  - b\n", "a body rewritten in the app"),
  );

  assert.equal(merged.action, "conflict");
  assert.deepEqual(merged.conflictFields, ["body"]);
  assert.match(merged.reason ?? "", /both sides changed body/);
});

test("several colliding fields are all named", () => {
  const merged = mergeBothChanged(
    { ...bothChanged, entity: { ...bothChanged.entity, title: "Their title" } },
    { ...base, bodyDigest: digestText("something else entirely") },
    noteContent("tags:\n  - a\n", "our rewrite", "Our title"),
  );

  assert.deepEqual(merged.conflictFields, ["title", "body"]);
  assert.match(merged.reason ?? "", /title and body/);
});

test("a folder with no recorded base is left exactly as it was", () => {
  assert.equal(mergeBothChanged(bothChanged, undefined, noteContent("", "x")), bothChanged);
  assert.equal(mergeBothChanged(bothChanged, base, undefined), bothChanged);
});

test("a type mismatch is not something a field merge can settle", () => {
  const mismatch: ImportDiffEntry = { ...bothChanged, kind: "type-mismatch" };
  assert.equal(mergeBothChanged(mismatch, base, noteContent("", "x")), mismatch);
});
