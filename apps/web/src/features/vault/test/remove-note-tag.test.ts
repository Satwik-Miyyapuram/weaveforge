/**
 * Removing a tag chip rewrites the note body the chip was drawn from. That body
 * can be stale: an edit saved since (another tab, a git pull, an outside editor)
 * must be kept as a conflict copy, never overwritten.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileNoteRepository } from "@/features/notes/infrastructure/file-note-repo";
import { removeNoteTag } from "../application/remove-note-tag";

before(loadTestCore);

test("a tag removed from a stale note keeps the outside edit as a conflict copy", async () => {
  const repo = new FileNoteRepository(new MemoryWorkspaceFs(), "thesis");
  const shown = await repo.add({ title: "Tagged", body: "Idea #draft #ml\n" });
  await repo.update(shown.id, { body: "Idea #draft #ml\nAdded outside.\n" });

  const saved = await removeNoteTag(repo, shown, "draft");

  assert.ok(saved.conflictCopyId, "the outside edit is kept as a copy");
  assert.equal((await repo.getById(saved.conflictCopyId!))?.body, "Idea #draft #ml\nAdded outside.\n");
  assert.doesNotMatch((await repo.getById(shown.id))?.body ?? "", /#draft/);
});

test("a tag removed from an up-to-date note saves with no copy", async () => {
  const repo = new FileNoteRepository(new MemoryWorkspaceFs(), "thesis");
  const shown = await repo.add({ title: "Tagged", body: "Idea #draft #ml\n" });

  const saved = await removeNoteTag(repo, shown, "draft");

  assert.equal(saved.conflictCopyId, undefined);
  assert.equal((await repo.list()).length, 1);
  assert.match(saved.body, /#ml/);
  assert.doesNotMatch(saved.body, /#draft/);
});
