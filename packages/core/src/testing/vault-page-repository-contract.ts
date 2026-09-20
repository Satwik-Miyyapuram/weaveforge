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

  // --- the lossy method (review-2 F4c) -------------------------------------
  //
  // `listSummaries` is the projection the note cards and the tree paint from,
  // and it is the one method no contract suite covered. It is required on the
  // port now, so the branches that recorded its absence are gone: an
  // implementation without it does not compile.
  test(`[${label}] listSummaries covers every saved page`, async () => {
    const repo = makeRepo();
    await repo.save(samplePage({ id: "a" }));
    await repo.save(samplePage({ id: "b", parentId: "a", title: "Child" }));
    const summaries = await repo.listSummaries();
    assert.deepEqual(
      summaries.map((s) => s.id).sort(),
      ["a", "b"],
      "a card/tree list that omits a page drops it from the screen",
    );
  });

  test(`[${label}] listSummaries keeps the identity the tree nests on`, async () => {
    const repo = makeRepo();
    const page = samplePage({ id: "child", parentId: "root", sortOrder: 3 });
    await repo.save(page);
    const [summary] = await repo.listSummaries();
    assert.ok(summary);
    assert.equal(summary.id, page.id);
    assert.equal(summary.title, page.title);
    // Nesting and ordering are read from the projection, not from getById.
    assert.equal(summary.parentId, "root");
    assert.equal(summary.sortOrder, 3);
    assert.equal(summary.updatedAt, page.updatedAt);
  });

  test(`[${label}] listSummaries gives the card text without claiming the body`, async () => {
    // The failure mode F6 names: the projection is concatenated with full rows
    // and written back, and `toRow` persists `body: p.body ?? ""` — wiping the
    // note. A summary must therefore either carry the real body or clearly not
    // carry one; `body: ""` with no preview is the one shape that is a lie.
    const repo = makeRepo();
    const page = samplePage({ id: "a", body: "A note with real content." });
    await repo.save(page);
    const [summary] = await repo.listSummaries();
    assert.ok(summary);
    const body = (summary as { body?: unknown }).body;
    if (body !== undefined) {
      assert.equal(body, page.body, "a summary that carries a body must carry the real one");
    } else {
      assert.ok(
        typeof summary.bodyPreview === "string" && summary.bodyPreview.length > 0,
        "a summary without a body must at least give the card a preview",
      );
    }
    // And the stored page is untouched either way.
    assert.equal((await repo.getById(page.id))?.body, page.body);
  });
}
