import { test } from "node:test";
import assert from "node:assert/strict";
import type { VaultPage } from "../features/vault/domain/vault-page.js";
import type { IVaultPageRepository } from "../features/vault/domain/vault-page-repository.js";

function samplePage(overrides: Partial<VaultPage> = {}): VaultPage {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: overrides.id ?? "p1",
    title: overrides.title ?? "Notes",
    body: overrides.body ?? "Hello",
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    parentId: overrides.parentId,
  };
}

export function runVaultPageRepositoryContract(
  label: string,
  makeRepo: () => IVaultPageRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const page = samplePage();
    await repo.save(page);
    const found = await repo.getById(page.id);
    assert.ok(found);
    assert.equal(found.title, page.title);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.getById("missing"), null);
  });

  test(`[${label}] list filters by parentId`, async () => {
    const repo = makeRepo();
    await repo.save(samplePage({ id: "root", parentId: undefined }));
    await repo.save(samplePage({ id: "child", parentId: "root", title: "Child" }));
    const roots = await repo.list({ parentId: null });
    assert.equal(roots.length, 1);
    assert.equal(roots[0]!.id, "root");
  });

  test(`[${label}] getTree nests children under parents`, async () => {
    const repo = makeRepo();
    await repo.save(samplePage({ id: "root" }));
    await repo.save(samplePage({ id: "child", parentId: "root", title: "Child" }));
    const tree = await repo.getTree();
    assert.equal(tree.length, 1);
    assert.equal(tree[0]!.page.id, "root");
    assert.equal(tree[0]!.children.length, 1);
    assert.equal(tree[0]!.children[0]!.page.id, "child");
  });

  test(`[${label}] delete removes the page`, async () => {
    const repo = makeRepo();
    const page = samplePage();
    await repo.save(page);
    await repo.delete(page.id);
    assert.equal(await repo.getById(page.id), null);
  });
}
