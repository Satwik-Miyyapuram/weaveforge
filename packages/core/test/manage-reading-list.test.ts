import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageReadingListUseCase,
  ReadingListValidationError,
  type ReadingList,
  type ReadingListItem,
  type ReadingListTreeNode,
  type IReadingListRepository,
  type IReadingListItemRepository,
} from "../src/index.js";

class FakeListRepo implements IReadingListRepository {
  readonly rows = new Map<string, ReadingList>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(l: ReadingList) {
    this.rows.set(l.id, l);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async getTree(): Promise<ReadingListTreeNode[]> {
    return [];
  }
}

class FakeItemRepo implements IReadingListItemRepository {
  items: ReadingListItem[] = [];
  async listItems(listId: string) {
    return this.items.filter((i) => i.listId === listId);
  }
  async listItemsForLists(listIds: readonly string[]) {
    return this.items.filter((i) => listIds.includes(i.listId));
  }
  async listsForPaper(paperId: string) {
    return this.items.filter((i) => i.paperId === paperId);
  }
  async listsForNote(vaultPageId: string) {
    return this.items.filter((i) => i.vaultPageId === vaultPageId);
  }
  async find(listId: string, paperId: string) {
    return this.items.find((i) => i.listId === listId && i.paperId === paperId) ?? null;
  }
  async findNote(listId: string, vaultPageId: string) {
    return this.items.find((i) => i.listId === listId && i.vaultPageId === vaultPageId) ?? null;
  }
  async add(item: ReadingListItem) {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.items[i] = item;
    else this.items.push(item);
  }
  async remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
  }
}

function makeSetup() {
  const lists = new FakeListRepo();
  const items = new FakeItemRepo();
  let n = 0;
  const uc = new ManageReadingListUseCase({
    lists,
    items,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `id-${++n}` },
  });
  return { lists, items, uc };
}

test("createList: trims the name and requires one", async () => {
  const { uc } = makeSetup();
  const list = await uc.createList({ name: "  Survey  " });
  assert.equal(list.name, "Survey");
  await assert.rejects(uc.createList({ name: " " }), ReadingListValidationError);
});

test("addPaperToList: adds with incrementing sortOrder and is idempotent", async () => {
  const { lists, items, uc } = makeSetup();
  lists.rows.set("L", { id: "L", name: "L", sortOrder: 0, createdAt: "t" } as ReadingList);
  const first = await uc.addPaperToList("L", "p1");
  assert.equal(first.sortOrder, 0);
  const second = await uc.addPaperToList("L", "p2");
  assert.equal(second.sortOrder, 1);
  // idempotent: re-adding p1 returns the same item, no duplicate
  const again = await uc.addPaperToList("L", "p1");
  assert.equal(again.id, first.id);
  assert.equal((await items.listItems("L")).length, 2);
});

test("addPaperToList: also links the paper into ancestor lists (inherited)", async () => {
  const { lists, items, uc } = makeSetup();
  lists.rows.set("parent", { id: "parent", name: "P", sortOrder: 0, createdAt: "t" } as ReadingList);
  lists.rows.set("child", { id: "child", name: "C", parentId: "parent", sortOrder: 0, createdAt: "t" } as ReadingList);
  await uc.addPaperToList("child", "p1");
  const childItem = await items.find("child", "p1");
  const parentItem = await items.find("parent", "p1");
  assert.ok(childItem && parentItem);
  assert.equal(childItem!.inheritedFromListId, undefined);
  assert.equal(parentItem!.inheritedFromListId, "child");
});

test("addPaperToList: rejects missing listId/paperId", async () => {
  const { uc } = makeSetup();
  await assert.rejects(uc.addPaperToList("", "p1"), ReadingListValidationError);
  await assert.rejects(uc.addPaperToList("L", ""), ReadingListValidationError);
});

test("reorderItems: validates completeness, duplicates, and applies new order", async () => {
  const { lists, items, uc } = makeSetup();
  lists.rows.set("L", { id: "L", name: "L", sortOrder: 0, createdAt: "t" } as ReadingList);
  await uc.addPaperToList("L", "p1");
  await uc.addPaperToList("L", "p2");
  const [a, b] = await items.listItems("L");

  await assert.rejects(uc.reorderItems("L", [a.id]), /must include every item/);
  await assert.rejects(uc.reorderItems("L", [a.id, a.id]), /duplicates/);

  await uc.reorderItems("L", [b.id, a.id]);
  const reordered = await items.listItems("L");
  assert.equal(reordered.find((i) => i.id === b.id)!.sortOrder, 0);
  assert.equal(reordered.find((i) => i.id === a.id)!.sortOrder, 1);
});

test("reorderPapers: maps paper ids to items and rejects a paper not in the list", async () => {
  const { lists, uc } = makeSetup();
  lists.rows.set("L", { id: "L", name: "L", sortOrder: 0, createdAt: "t" } as ReadingList);
  await uc.addPaperToList("L", "p1");
  await uc.addPaperToList("L", "p2");
  await uc.reorderPapers("L", ["p2", "p1"]); // should not throw
  await assert.rejects(uc.reorderPapers("L", ["p2", "p1", "p9"]), /is not in list/);
});
