import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageVaultPageUseCase,
  VaultPageValidationError,
  type VaultPage,
  type VaultPageTreeNode,
  type IVaultPageRepository,
} from "../src/index.js";

class InMemoryVaultRepo implements IVaultPageRepository {
  readonly rows = new Map<string, VaultPage>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(p: VaultPage) {
    this.rows.set(p.id, p);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async getTree(): Promise<VaultPageTreeNode[]> {
    return [];
  }
}

function makeUseCase() {
  const repo = new InMemoryVaultRepo();
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
