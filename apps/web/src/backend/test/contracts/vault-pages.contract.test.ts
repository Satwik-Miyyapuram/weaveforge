// contract-repos: vault_pages
import assert from "node:assert/strict";
import test from "node:test";
import type { VaultPage } from "@weaveforge/core";
import { rustVaultPageRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IVaultPageRepository` and `IVaultPageManager` contract, end to end: Rust
 * plans each query, the TS sender runs it against PGlite with the real
 * `vault_pages` migration and RLS. Ported from the deleted
 * `vault-page-repository-contract.ts` suite and `manage-vault-page.test.ts`.
 */

async function repoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustVaultPageRepository(clientFor(db, userId), projectFor(projectId));
}

function samplePage(overrides: Partial<VaultPage> = {}): VaultPage {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    // Titles are unique per project, so each page gets its own by default.
    title: `Page ${crypto.randomUUID().slice(0, 8)}`,
    body: "Hello",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Rejects with the exact message and error name Rust gives the caller. */
async function assertRejectsWith(p: Promise<unknown>, message: string, name: string) {
  await assert.rejects(p, (e: Error) => e.message === message && e.name === name);
}

test("save then getById returns the entity", async () => {
  const repo = await repoFor(await testDb());
  const page = samplePage();
  await repo.save(page);
  const found = await repo.getById(page.id);
  assert.equal(found!.title, page.title);
});

test("getById returns null when absent", async () => {
  const repo = await repoFor(await testDb());
  assert.equal(await repo.getById(crypto.randomUUID()), null);
});

test("list filters by parentId", async () => {
  const repo = await repoFor(await testDb());
  const root = crypto.randomUUID();
  await repo.save(samplePage({ id: root, parentId: undefined }));
  await repo.save(samplePage({ parentId: root, title: "Child" }));
  const roots = await repo.list({ parentId: null });
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.id, root);
});

test("getTree nests children under parents", async () => {
  const repo = await repoFor(await testDb());
  const root = crypto.randomUUID();
  const child = crypto.randomUUID();
  await repo.save(samplePage({ id: root }));
  await repo.save(samplePage({ id: child, parentId: root, title: "Child" }));
  const tree = await repo.getTree();
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.page.id, root);
  assert.equal(tree[0]!.children.length, 1);
  assert.equal(tree[0]!.children[0]!.page.id, child);
});

test("delete removes the page", async () => {
  const repo = await repoFor(await testDb());
  const page = samplePage();
  await repo.save(page);
  await repo.delete(page.id);
  assert.equal(await repo.getById(page.id), null);
});

test("listSummaries covers every saved page", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await repo.save(samplePage({ id: a }));
  await repo.save(samplePage({ id: b, parentId: a, title: "Child" }));
  const summaries = await repo.listSummaries();
  assert.deepEqual(
    summaries.map((s) => s.id).sort(),
    [a, b].sort(),
    "a card/tree list that omits a page drops it from the screen",
  );
});

test("listSummaries keeps the identity the tree nests on", async () => {
  const repo = await repoFor(await testDb());
  const root = crypto.randomUUID();
  const page = samplePage({ parentId: root, sortOrder: 3 });
  await repo.save(samplePage({ id: root }));
  await repo.save(page);
  const summary = (await repo.listSummaries()).find((s) => s.id === page.id)!;
  assert.equal(summary.id, page.id);
  assert.equal(summary.title, page.title);
  // Nesting and ordering are read from the projection, not from getById.
  assert.equal(summary.parentId, root);
  assert.equal(summary.sortOrder, 3);
  // updated_at is set by the database trigger (0128), so compare with the stored row.
  assert.equal(summary.updatedAt, (await repo.getById(page.id))!.updatedAt);
});

test("listSummaries gives the card text without claiming the body", async () => {
  // The failure mode F6 names: the projection is concatenated with full rows
  // and written back, and `toRow` persists `body: p.body ?? ""` — wiping the
  // note. A summary must therefore either carry the real body or clearly not
  // carry one; `body: ""` with no preview is the one shape that is a lie.
  const repo = await repoFor(await testDb());
  const page = samplePage({ body: "A note with real content." });
  await repo.save(page);
  const summary = (await repo.listSummaries())[0]!;
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

// --- ManageVaultPage, through the repository's add / update / remove ---------
// Titles are the deleted manage-vault-page.test.ts cases; assertions and
// messages mirror crates/wf-core/src/repos/vault_pages.rs (the add/update/remove
// arms the tests cover).

test("add: trims title, defaults body, requires a title", async () => {
  const repo = await repoFor(await testDb());
  const page = await repo.add({ title: "  Notes  " });
  assert.equal(page.title, "Notes");
  assert.equal(page.body, "");
  await assertRejectsWith(repo.add({ title: " " }), "Page title is required.", "VaultPageValidationError");
});

test("add: rejects a case-insensitive duplicate title", async () => {
  const repo = await repoFor(await testDb());
  await repo.add({ title: "My Note" });
  await assertRejectsWith(
    repo.add({ title: "  my note  " }),
    "A note titled “my note” already exists.",
    "VaultPageValidationError",
  );
});

test("update: edits title/body, bumps updatedAt, preserves id/createdAt", async () => {
  const repo = await repoFor(await testDb());
  const created = await repo.add({ title: "Old", body: "a" });
  const updated = await repo.update(created.id, { title: "New", body: "b" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.title, "New");
  assert.equal(updated.body, "b");
});

test("update: blocks renaming onto another page's title", async () => {
  const repo = await repoFor(await testDb());
  await repo.add({ title: "First" });
  const second = await repo.add({ title: "Second" });
  await assertRejectsWith(
    repo.update(second.id, { title: "first" }),
    "A note titled “first” already exists.",
    "VaultPageValidationError",
  );
});

test("update: throws for unknown id and blank title; remove deletes", async () => {
  const repo = await repoFor(await testDb());
  const missing = crypto.randomUUID();
  await assertRejectsWith(
    repo.update(missing, { title: "x" }),
    `No vault page with id "${missing}".`,
    "NotFoundError",
  );
  const created = await repo.add({ title: "Temp" });
  await assertRejectsWith(repo.update(created.id, { title: "  " }), "Page title is required.", "VaultPageValidationError");
  await repo.remove(created.id);
  assert.equal(await repo.getById(created.id), null);
});

test("update: moves a page under another, to the top with null, and never into itself", async () => {
  const repo = await repoFor(await testDb());
  const folder = await repo.add({ title: "Folder" });
  const page = await repo.add({ title: "Page" });
  const moved = await repo.update(page.id, { parentId: folder.id });
  assert.equal(moved.parentId, folder.id);
  // Absent leaves the parent alone; null clears it.
  assert.equal((await repo.update(page.id, { body: "x" })).parentId, folder.id);
  assert.ok(!(await repo.update(page.id, { parentId: null })).parentId);
  await assertRejectsWith(
    repo.update(folder.id, { parentId: folder.id }),
    "A note cannot be moved inside itself.",
    "VaultPageValidationError",
  );
  await repo.update(page.id, { parentId: folder.id });
  // The folder is the page's ancestor: moving it under the page closes a loop.
  await assertRejectsWith(
    repo.update(folder.id, { parentId: page.id }),
    "A note cannot be moved inside itself.",
    "VaultPageValidationError",
  );
});

test("update: pins and unpins a note, keeping its body", async () => {
  const repo = await repoFor(await testDb());
  const created = await repo.add({ title: "Keep", body: "text" });
  await repo.update(created.id, { pinned: true });
  const summary = (await repo.listSummaries()).find((s) => s.id === created.id);
  assert.equal(summary?.pinned, true);
  assert.equal((await repo.getById(created.id))?.body, "text");
  const unpinned = await repo.update(created.id, { pinned: false });
  assert.equal(unpinned.pinned, false);
});
