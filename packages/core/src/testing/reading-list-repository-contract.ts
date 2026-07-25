/**
 * Shared CONTRACT test suites for the reading-list repositories.
 *
 * Every implementation (in-memory, Supabase, SQLite) must pass these — the
 * basis for Liskov substitutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ReadingList,
  ReadingListItem,
} from "../features/reading-lists/domain/reading-list.js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
} from "../features/reading-lists/domain/reading-list-repository.js";

function sampleList(overrides: Partial<ReadingList> = {}): ReadingList {
  return {
    id: overrides.id ?? "l1",
    name: overrides.name ?? "Latent spaces",
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
    parentId: overrides.parentId,
    ...overrides,
  };
}

function sampleItem(overrides: Partial<ReadingListItem> = {}): ReadingListItem {
  return {
    id: overrides.id ?? "i1",
    listId: overrides.listId ?? "l1",
    paperId: overrides.paperId ?? "p1",
    sortOrder: overrides.sortOrder ?? 0,
    note: overrides.note,
    ...overrides,
  };
}

export function runReadingListRepositoryContract(
  label: string,
  makeRepo: () => IReadingListRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    await repo.save(sampleList());
    assert.equal((await repo.getById("l1"))?.name, "Latent spaces");
  });

  test(`[${label}] list filters top-level by parentId null`, async () => {
    const repo = makeRepo();
    await repo.save(sampleList({ id: "root" }));
    await repo.save(sampleList({ id: "child", parentId: "root" }));
    const tops = await repo.list({ parentId: null });
    assert.equal(tops.length, 1);
    assert.equal(tops[0]?.id, "root");
  });

  test(`[${label}] getTree nests children under parents`, async () => {
    const repo = makeRepo();
    await repo.save(sampleList({ id: "root", sortOrder: 0 }));
    await repo.save(sampleList({ id: "b", parentId: "root", sortOrder: 2 }));
    await repo.save(sampleList({ id: "a", parentId: "root", sortOrder: 1 }));
    const tree = await repo.getTree();
    assert.equal(tree.length, 1);
    assert.deepEqual(
      tree[0]?.children.map((c) => c.list.id),
      ["a", "b"],
    );
  });

  test(`[${label}] delete removes the entity`, async () => {
    const repo = makeRepo();
    await repo.save(sampleList());
    await repo.delete("l1");
    assert.equal(await repo.getById("l1"), null);
  });
}

export function runReadingListItemRepositoryContract(
  label: string,
  makeRepo: () => IReadingListItemRepository,
): void {
  test(`[${label} items] add then find by (list, paper)`, async () => {
    const repo = makeRepo();
    await repo.add(sampleItem());
    const found = await repo.find("l1", "p1");
    assert.equal(found?.id, "i1");
    assert.equal(await repo.find("l1", "absent"), null);
  });

  test(`[${label} items] listItems returns a list's members ordered`, async () => {
    const repo = makeRepo();
    await repo.add(sampleItem({ id: "a", paperId: "pa", sortOrder: 2 }));
    await repo.add(sampleItem({ id: "b", paperId: "pb", sortOrder: 1 }));
    await repo.add(sampleItem({ id: "c", listId: "other", paperId: "pc" }));
    const members = await repo.listItems("l1");
    assert.deepEqual(
      members.map((m) => m.id),
      ["b", "a"],
    );
  });

  test(`[${label} items] listsForPaper returns every membership`, async () => {
    const repo = makeRepo();
    await repo.add(sampleItem({ id: "a", listId: "l1", paperId: "p1" }));
    await repo.add(sampleItem({ id: "b", listId: "l2", paperId: "p1" }));
    const memberships = await repo.listsForPaper("p1");
    assert.equal(memberships.length, 2);
  });

  test(`[${label} items] remove deletes the membership`, async () => {
    const repo = makeRepo();
    await repo.add(sampleItem());
    await repo.remove("i1");
    assert.equal(await repo.find("l1", "p1"), null);
  });

  test(`[${label} items] add note then findNote by (list, note)`, async () => {
    const repo = makeRepo();
    await repo.add(sampleItem({ id: "n1", paperId: undefined, vaultPageId: "v1" }));
    const found = await repo.findNote("l1", "v1");
    assert.equal(found?.id, "n1");
    assert.equal(await repo.findNote("l1", "absent"), null);
  });
}
