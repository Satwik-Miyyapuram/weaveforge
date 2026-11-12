// contract-repos: reading_lists, reading_list_items
import assert from "node:assert/strict";
import test from "node:test";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
  Paper,
  ReadingList,
  ReadingListItem,
  VaultPage,
} from "@weaveforge/core";
import { projectUserCtx, rustRepository, rustVaultPageRepository } from "@/backend/providers/postgrest/rust-repository";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IReadingListRepository` and `IReadingListItemRepository` contract, end
 * to end: Rust plans each query, the TS sender runs it against PGlite with the
 * real `reading_lists` / `reading_list_items` migrations and RLS. Ported from
 * the deleted `reading-list-repository-contract.ts` suite.
 */

async function setup(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const client = clientFor(db, userId);
  const project = projectFor(projectId);
  return {
    papers: rustPaperRepository(client, project),
    vaultPages: rustVaultPageRepository(client, project),
    lists: rustRepository<IReadingListRepository & { listByIds(ids: readonly string[]): Promise<ReadingList[]> }>(
      client,
      "reading_lists",
      ["getById", "listByIds", "list", "getTree", "save", "delete"],
      projectUserCtx(project),
    ),
    items: rustRepository<IReadingListItemRepository>(client, "reading_list_items", [
      "listItems",
      "listItemsForLists",
      "listsForPaper",
      "listsForNote",
      "find",
      "findNote",
      "add",
      "remove",
    ] as (keyof IReadingListItemRepository & string)[]),
  };
}

type Repos = Awaited<ReturnType<typeof setup>>;

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma", "Welling"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sampleVaultPage(): VaultPage {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    title: `Page ${crypto.randomUUID().slice(0, 8)}`,
    body: "Hello",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function sampleList(overrides: Partial<ReadingList> = {}): ReadingList {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Latent spaces",
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
    parentId: overrides.parentId,
    ...overrides,
  };
}

async function seedPaper(r: Repos): Promise<string> {
  const paper = samplePaper();
  await r.papers.save(paper);
  return paper.id;
}

test("save then getById returns the entity", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  await r.lists.save(list);
  assert.equal((await r.lists.getById(list.id))?.name, "Latent spaces");
});

test("list filters top-level by parentId null", async () => {
  const r = await setup(await testDb());
  const root = sampleList();
  await r.lists.save(root);
  await r.lists.save(sampleList({ parentId: root.id }));
  const tops = await r.lists.list({ parentId: null });
  assert.equal(tops.length, 1);
  assert.equal(tops[0]?.id, root.id);
});

test("getTree nests children under parents", async () => {
  const r = await setup(await testDb());
  const root = sampleList({ sortOrder: 0 });
  const a = sampleList({ parentId: root.id, sortOrder: 1 });
  const b = sampleList({ parentId: root.id, sortOrder: 2 });
  await r.lists.save(root);
  await r.lists.save(b);
  await r.lists.save(a);
  const tree = await r.lists.getTree();
  assert.equal(tree.length, 1);
  assert.deepEqual(
    tree[0]?.children.map((c) => c.list.id),
    [a.id, b.id],
  );
});

test("delete removes the entity", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  await r.lists.save(list);
  await r.lists.delete(list.id);
  assert.equal(await r.lists.getById(list.id), null);
});

test("items: add then find by (list, paper)", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  await r.lists.save(list);
  const paperId = await seedPaper(r);
  const item: ReadingListItem = { id: crypto.randomUUID(), listId: list.id, paperId, sortOrder: 0 };
  await r.items.add(item);
  const found = await r.items.find(list.id, paperId);
  assert.equal(found?.id, item.id);
  assert.equal(await r.items.find(list.id, crypto.randomUUID()), null);
});

test("items: listItems returns a list's members ordered", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  const other = sampleList();
  await r.lists.save(list);
  await r.lists.save(other);
  const a: ReadingListItem = { id: crypto.randomUUID(), listId: list.id, paperId: await seedPaper(r), sortOrder: 2 };
  const b: ReadingListItem = { id: crypto.randomUUID(), listId: list.id, paperId: await seedPaper(r), sortOrder: 1 };
  const c: ReadingListItem = { id: crypto.randomUUID(), listId: other.id, paperId: await seedPaper(r), sortOrder: 0 };
  await r.items.add(a);
  await r.items.add(b);
  await r.items.add(c);
  const members = await r.items.listItems(list.id);
  assert.deepEqual(
    members.map((m) => m.id),
    [b.id, a.id],
  );
});

test("items: listsForPaper returns every membership", async () => {
  const r = await setup(await testDb());
  const l1 = sampleList();
  const l2 = sampleList();
  await r.lists.save(l1);
  await r.lists.save(l2);
  const paperId = await seedPaper(r);
  await r.items.add({ id: crypto.randomUUID(), listId: l1.id, paperId, sortOrder: 0 });
  await r.items.add({ id: crypto.randomUUID(), listId: l2.id, paperId, sortOrder: 0 });
  const memberships = await r.items.listsForPaper(paperId);
  assert.equal(memberships.length, 2);
});

test("items: remove deletes the membership", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  await r.lists.save(list);
  const paperId = await seedPaper(r);
  const item: ReadingListItem = { id: crypto.randomUUID(), listId: list.id, paperId, sortOrder: 0 };
  await r.items.add(item);
  await r.items.remove(item.id);
  assert.equal(await r.items.find(list.id, paperId), null);
});

test("items: add note then findNote by (list, note)", async () => {
  const r = await setup(await testDb());
  const list = sampleList();
  await r.lists.save(list);
  const page = sampleVaultPage();
  await r.vaultPages.save(page);
  const note: ReadingListItem = { id: crypto.randomUUID(), listId: list.id, vaultPageId: page.id, sortOrder: 0 };
  await r.items.add(note);
  const found = await r.items.findNote(list.id, page.id);
  assert.equal(found?.id, note.id);
  assert.equal(await r.items.findNote(list.id, crypto.randomUUID()), null);
});
