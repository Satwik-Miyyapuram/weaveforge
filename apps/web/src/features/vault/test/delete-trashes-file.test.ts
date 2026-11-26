/**
 * Deleting a note with a folder open moves its file to the folder trash (P1, 0.9.7 review).
 *
 * The delete removed only the database row. The note's `.md` stayed in the
 * folder with its manifest base, so "Check for changes" listed it as new and an
 * import brought the note back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type NoteFiles, withDeleteTrashesFile } from "../application/delete-trashes-file";

type Pages = { remove(id: string): Promise<void> };

function harness(options: { path?: string | null; trashFails?: boolean; removeFails?: boolean } = {}) {
  const steps: string[] = [];
  const warnings: string[] = [];
  const pages = {
    remove: async (id: string) => {
      if (options.removeFails) throw new Error("offline");
      steps.push(`remove ${id}`);
    },
    list: async () => [],
  };
  const files: NoteFiles = {
    pathOf: async (id) => {
      steps.push(`find ${id}`);
      return options.path === undefined ? `notes/${id}.md` : options.path;
    },
    trash: async (path) => {
      if (options.trashFails) throw new Error("disk full");
      steps.push(`trash ${path}`);
    },
  };
  const repo = withDeleteTrashesFile(pages, files, (message) => warnings.push(message));
  return { repo, steps, warnings };
}

test("deleting a note finds its file, removes the note, then trashes the file", async () => {
  const { repo, steps, warnings } = harness();
  await repo.remove("n1");
  assert.deepEqual(steps, ["find n1", "remove n1", "trash notes/n1.md"]);
  assert.deepEqual(warnings, []);
});

test("a note with no file in the folder (or no folder open) is only removed from the database", async () => {
  const { repo, steps, warnings } = harness({ path: null });
  await repo.remove("n1");
  assert.deepEqual(steps, ["find n1", "remove n1"]);
  assert.deepEqual(warnings, []);
});

test("a failed trash keeps the delete and warns instead of throwing", async () => {
  const { repo, steps, warnings } = harness({ trashFails: true });
  await repo.remove("n1");
  assert.deepEqual(steps, ["find n1", "remove n1"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /disk full/);
});

test("a failed database delete leaves the file alone and throws", async () => {
  const { repo, steps } = harness({ removeFails: true });
  await assert.rejects(repo.remove("n1"), /offline/);
  assert.deepEqual(steps, ["find n1"], "nothing is trashed");
});

test("a note whose repository trashes its file still has its strokes folder trashed", async () => {
  // The file repository moves the .md itself, so the path must be found before the delete.
  let exists = true;
  const trashed: string[] = [];
  const pages: Pages = { remove: async () => void (exists = false) };
  const files: NoteFiles = {
    pathOf: async () => (exists ? "notes/a.note.md" : null),
    trash: async (path) => void trashed.push(path),
  };
  await withDeleteTrashesFile(pages, files, () => {}).remove("n1");
  assert.deepEqual(trashed, ["notes/a.note.md"]);
});

test("a failed file lookup still deletes the note and warns", async () => {
  const warnings: string[] = [];
  let removed = false;
  const files: NoteFiles = { pathOf: async () => Promise.reject(new Error("no folder")), trash: async () => {} };
  const pages: Pages = { remove: async () => void (removed = true) };
  await withDeleteTrashesFile(pages, files, (m) => warnings.push(m)).remove("n1");
  assert.equal(removed, true);
  assert.match(warnings[0] ?? "", /no folder/);
});

test("the other repository methods pass through", async () => {
  const { repo } = harness();
  assert.deepEqual(await repo.list(), []);
});

test("the container wraps manageVaultPage so every delete door trashes the file", () => {
  const src = readFileSync(fileURLToPath(new URL("../../../create-app-container.ts", import.meta.url)), "utf8");
  assert.match(src, /const manageVaultPage = withDeleteTrashesFile\(\s*withRenameLinkRewrite\(vaultPageRepository\)/);
});
