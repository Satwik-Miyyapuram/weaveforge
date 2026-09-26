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
  const folder = await uc.add({ title: "Folder" });
  const page = await uc.add({ title: "Page" });
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
