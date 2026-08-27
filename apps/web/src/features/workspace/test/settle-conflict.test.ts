import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportDiffEntry } from "@weaveforge/core";

import {
  keepBothTitle,
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
