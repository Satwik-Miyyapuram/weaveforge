import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageVaultPageUseCase,
  VaultPageValidationError,
  type VaultPage,
} from "../../../src/index.js";
import { InMemoryVaultPageRepository } from "../../../src/testing/in-memory-vault-page-repository.js";

/**
 * The shipped in-memory repository, not a hand-rolled one.
 *
 * This test used to define its own `implements IVaultPageRepository` fake. That
 * is fine while the port is stable and quietly wrong the moment a method becomes
 * required: core's tests are not type-checked, so a fake missing
 * `listSummaries` compiled and then threw at runtime — six tests at once, with a
 * `TypeError` naming an internal field. The real double cannot drift like that,
 * and it is the same object the contract suite checks.
 */
function makeUseCase() {
  const repo = new InMemoryVaultPageRepository();
  let n = 0;
  const uc = new ManageVaultPageUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `vp-${++n}` },
  });
  return { repo, uc };
}

test("add: trims title, defaults body, requires a title", async () => {
  const { uc } = makeUseCase();
  const page = await uc.add({ title: "  Notes  " });
  assert.equal(page.title, "Notes");
  assert.equal(page.body, "");
  await assert.rejects(uc.add({ title: " " }), VaultPageValidationError);
});

test("add: rejects a case-insensitive duplicate title", async () => {
  const { uc } = makeUseCase();
  await uc.add({ title: "My Note" });
  await assert.rejects(uc.add({ title: "  my note  " }), /already exists/);
});

test("update: edits title/body, bumps updatedAt, preserves id/createdAt", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ title: "Old", body: "a" });
  const updated = await uc.update(created.id, { title: "New", body: "b" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.title, "New");
  assert.equal(updated.body, "b");
});

test("update: blocks renaming onto another page's title", async () => {
  const { uc } = makeUseCase();
  await uc.add({ title: "First" });
  const second = await uc.add({ title: "Second" });
  await assert.rejects(uc.update(second.id, { title: "first" }), /already exists/);
});

test("update: throws for unknown id and blank title; remove deletes", async () => {
  const { repo, uc } = makeUseCase();
  await assert.rejects(uc.update("nope", { title: "x" }), /No vault page with id/);
  const created = await uc.add({ title: "Temp" });
  await assert.rejects(uc.update(created.id, { title: "  " }), /title is required/);
  await uc.remove(created.id);
  assert.equal(await repo.getById(created.id), null);
});

test("update: moves a page under another, to the top with null, and never into itself", async () => {
  const { uc } = makeUseCase();
  const folder = await uc.add({ title: "Folder", isFolder: true });
  const page = await uc.add({ title: "Page", isFolder: true });
  const moved = await uc.update(page.id, { parentId: folder.id });
  assert.equal(moved.parentId, folder.id);
  // Absent leaves the parent alone; null clears it.
  assert.equal((await uc.update(page.id, { body: "x" })).parentId, folder.id);
  assert.equal((await uc.update(page.id, { parentId: null })).parentId, undefined);
  await assert.rejects(uc.update(folder.id, { parentId: folder.id }), /inside itself/);
  await uc.update(page.id, { parentId: folder.id });
  await assert.rejects(uc.update(folder.id, { parentId: page.id }), /inside itself/);
});

test("update: pins and unpins a note, keeping its body", async () => {
  const { repo, uc } = makeUseCase();
  const created = await uc.add({ title: "Keep", body: "text" });
  await uc.update(created.id, { pinned: true });
  const [summary] = await repo.listSummaries();
  assert.equal(summary?.pinned, true);
  assert.equal((await repo.getById(created.id))?.body, "text");
  const unpinned = await uc.update(created.id, { pinned: false });
  assert.equal(unpinned.pinned, false);
});

test("update: keeps its exact move refusals: self, descendant, missing parent (xhelp-18)", async () => {
  const { repo, uc } = makeUseCase();
  const a = await uc.add({ title: "A", isFolder: true });
  const b = await uc.add({ title: "B", parentId: a.id, isFolder: true });
  const c = await uc.add({ title: "C", parentId: b.id });
  const inside = { name: "VaultPageValidationError", message: "A note cannot be moved inside itself." };
  await assert.rejects(uc.update(a.id, { parentId: a.id }), inside);
  await assert.rejects(uc.update(a.id, { parentId: c.id }), inside);
  await assert.rejects(uc.update(a.id, { parentId: "nope" }), { name: "NotFoundError", message: 'No vault page with id "nope".' });
  await repo.save({ ...(await repo.getById(b.id))!, parentId: "ghost" });
  await assert.rejects(uc.update(a.id, { parentId: c.id }), { name: "NotFoundError", message: `No vault page with id "${c.id}".` });
});

test("update: a move under a loop already in the data still lands", async () => {
  const { repo, uc } = makeUseCase();
  const x = await uc.add({ title: "X" });
  const y = await uc.add({ title: "Y" });
  const m = await uc.add({ title: "M" });
  await repo.save({ ...(await repo.getById(x.id))!, parentId: y.id });
  await repo.save({ ...(await repo.getById(y.id))!, parentId: x.id });
  assert.equal((await uc.update(m.id, { parentId: x.id })).parentId, x.id);
});

test("the duplicate-title check reads no page list (05-02)", async () => {
  const { repo, uc } = makeUseCase();
  let listed = 0;
  repo.listSummaries = async () => {
    listed += 1;
    return [];
  };
  repo.list = async () => {
    listed += 1;
    return [];
  };
  const a = await uc.add({ title: "Alpha" });
  await assert.rejects(() => uc.add({ title: "ALPHA" }), VaultPageValidationError);
  await uc.update(a.id, { title: "Beta" });
  await uc.add({ title: "alpha" });
  assert.equal(listed, 0);
});

// Notes are not nested in notes: only a folder holds pages. A page that
// already holds pages (made before folders had a flag) counts as a folder.
const NOT_A_FOLDER = { name: "VaultPageValidationError", message: "A note can only go in a folder." };

test("add: a folder is marked; a note is not", async () => {
  const { repo, uc } = makeUseCase();
  const folder = await uc.add({ title: "Folder", isFolder: true });
  const note = await uc.add({ title: "Note" });
  assert.equal(folder.isFolder, true);
  assert.equal(note.isFolder, undefined);
  const summaries = await repo.listSummaries();
  assert.equal(summaries.find((p) => p.id === folder.id)?.isFolder, true);
});

test("add: a page goes in a folder, never under a note", async () => {
  const { uc } = makeUseCase();
  const folder = await uc.add({ title: "Folder", isFolder: true });
  const note = await uc.add({ title: "Note" });
  assert.equal((await uc.add({ title: "In folder", parentId: folder.id })).parentId, folder.id);
  assert.equal((await uc.add({ title: "Sub", parentId: folder.id, isFolder: true })).isFolder, true);
  await assert.rejects(uc.add({ title: "Under note", parentId: note.id }), NOT_A_FOLDER);
  await assert.rejects(uc.add({ title: "Folder under note", parentId: note.id, isFolder: true }), NOT_A_FOLDER);
  await assert.rejects(uc.add({ title: "Ghost", parentId: "nope" }), { name: "NotFoundError" });
});

test("a page that already holds pages counts as a folder (legacy data)", async () => {
  const { repo, uc } = makeUseCase();
  const old = await uc.add({ title: "Old parent" });
  const child = await uc.add({ title: "Child" });
  await repo.save({ ...(await repo.getById(child.id))!, parentId: old.id });
  assert.equal((await uc.add({ title: "Another", parentId: old.id })).parentId, old.id);
});

test("update: a move lands in a folder or the top, never under a note", async () => {
  const { uc } = makeUseCase();
  const folder = await uc.add({ title: "Folder", isFolder: true });
  const note = await uc.add({ title: "Note" });
  const page = await uc.add({ title: "Page" });
  await assert.rejects(uc.update(page.id, { parentId: note.id }), NOT_A_FOLDER);
  assert.equal((await uc.update(page.id, { parentId: folder.id })).parentId, folder.id);
  assert.equal((await uc.update(page.id, { parentId: null })).parentId, undefined);
  // A rename never re-checks the parent it already has.
  assert.equal((await uc.update(note.id, { title: "Renamed" })).title, "Renamed");
});

test("update: a page can be made a folder, which then takes pages", async () => {
  const { uc } = makeUseCase();
  const root = await uc.add({ title: "Wiki" });
  const page = await uc.add({ title: "Page" });
  assert.equal((await uc.update(root.id, { isFolder: true })).isFolder, true);
  assert.equal((await uc.update(page.id, { parentId: root.id })).parentId, root.id);
});
