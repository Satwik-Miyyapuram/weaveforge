import assert from "node:assert/strict";
import { test } from "node:test";

import { changedSide, diffWorkspace, digestText, type ParsedEntity } from "../../src/workspace/index.js";

test("a digest is stable and text-sensitive", () => {
  assert.equal(digestText("hello"), digestText("hello"));
  assert.notEqual(digestText("hello"), digestText("hello "));
  assert.notEqual(digestText("ab"), digestText("ba"));
});

test("who moved is read from the three digests", () => {
  const side = (base: string, folder: string, workspace: string) =>
    changedSide({ base: digestText(base), folder: digestText(folder), workspace: digestText(workspace) });

  assert.equal(side("a", "a", "a"), "neither");
  assert.equal(side("a", "b", "a"), "folder");
  assert.equal(side("a", "a", "b"), "workspace");
  assert.equal(side("a", "b", "c"), "both");
  // Both sides arriving at the same text is agreement, not a conflict.
  assert.equal(side("a", "b", "b"), "neither");
});

test("a missing side is unknown, never a guess", () => {
  assert.equal(changedSide({ folder: "x", workspace: "y" }), "unknown");
  assert.equal(changedSide({ base: "x", workspace: "y" }), "unknown");
  assert.equal(changedSide({ base: "x", folder: "y" }), "unknown");
});

const note: ParsedEntity = {
  id: "n1",
  type: "vault_page",
  title: "Edited outside",
  body: "from the folder",
  path: "notes/n1.note.md",
};

const stored = [{ id: "n1", type: "vault_page" as const, title: "Original", body: "in the workspace" }];

test("a folder edit is an update", () => {
  const diff = diffWorkspace([note], stored, { origin: () => "folder" });
  assert.equal(diff.entries[0]?.action, "updated");
});

test("a workspace edit is not something to import back", () => {
  // The folder's copy is simply the older one; carrying it over would undo the
  // edit that has not been mirrored yet.
  const diff = diffWorkspace([note], stored, { origin: () => "workspace" });
  assert.equal(diff.entries[0]?.action, "unchanged");
});

test("both sides moving is a conflict, with a reason naming the file", () => {
  const diff = diffWorkspace([note], stored, { origin: () => "both" });
  assert.equal(diff.entries[0]?.action, "conflict");
  assert.match(diff.entries[0]?.reason ?? "", /notes\/n1\.note\.md/);
});

test("without an origin the diff behaves as it always did", () => {
  assert.equal(diffWorkspace([note], stored).entries[0]?.action, "updated");
  assert.equal(diffWorkspace([note], stored, { origin: () => "unknown" }).entries[0]?.action, "updated");
});

test("identical copies are unchanged whatever the origin says", () => {
  const same: ParsedEntity = { ...note, title: "Original", body: "in the workspace" };
  assert.equal(diffWorkspace([same], stored, { origin: () => "both" }).entries[0]?.action, "unchanged");
});
