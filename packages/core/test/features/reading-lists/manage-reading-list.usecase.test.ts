import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryReadingListItemRepository,
  InMemoryReadingListRepository,
} from "../../../src/testing/in-memory-reading-list-repository.js";
import { ManageReadingListUseCase } from "../../../src/features/reading-lists/application/manage-reading-list.use-case.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");

function makeUseCase() {
  const lists = new InMemoryReadingListRepository();
  const items = new InMemoryReadingListItemRepository();
  const uc = new ManageReadingListUseCase({ lists, items, clock, ids: seqIds() });
  return { lists, items, uc };
}

test("createList persists a named list", async () => {
  const { lists, uc } = makeUseCase();
  const l = await uc.createList({ name: "Disentanglement" });
  assert.equal((await lists.getById(l.id))?.name, "Disentanglement");
});

test("createList rejects empty name", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(() => uc.createList({ name: "  " }));
});

test("addPaperToList is idempotent on (list, paper)", async () => {
  const { items, uc } = makeUseCase();
  const first = await uc.addPaperToList("l1", "p1", "seminal");
  const second = await uc.addPaperToList("l1", "p1");
  assert.equal(second.id, first.id);
  assert.equal((await items.listItems("l1")).length, 1);
});

test("removePaperFromList deletes the membership", async () => {
  const { items, uc } = makeUseCase();
  await uc.addPaperToList("l1", "p1");
  await uc.removePaperFromList("l1", "p1");
  assert.equal((await items.listItems("l1")).length, 0);
});

test("addPaperToList propagates to ancestor lists", async () => {
  const { lists, items, uc } = makeUseCase();
  const parent = await uc.createList({ name: "Parent" });
  const child = await uc.createList({ name: "Child", parentId: parent.id });
  await uc.addPaperToList(child.id, "p1");

  assert.equal((await items.listItems(child.id)).length, 1);
  assert.equal((await items.listItems(parent.id)).length, 1);
  assert.equal((await lists.getById(parent.id))?.name, "Parent");
});

test("addPaperToList marks ancestor memberships as inherited", async () => {
  const { items, uc } = makeUseCase();
  const parent = await uc.createList({ name: "Parent" });
  const child = await uc.createList({ name: "Child", parentId: parent.id });
  await uc.addPaperToList(child.id, "p1");

  const parentItem = (await items.listItems(parent.id))[0]!;
  const childItem = (await items.listItems(child.id))[0]!;
  assert.equal(parentItem.inheritedFromListId, child.id);
  assert.equal(childItem.inheritedFromListId, undefined);
});

test("removePaperFromList deletes inherited copies on ancestors", async () => {
  const { items, uc } = makeUseCase();
  const parent = await uc.createList({ name: "Parent" });
  const child = await uc.createList({ name: "Child", parentId: parent.id });
  await uc.addPaperToList(child.id, "p1");

  assert.equal((await items.listItems(parent.id)).length, 1);
  await uc.removePaperFromList(child.id, "p1");
  assert.equal((await items.listItems(child.id)).length, 0);
  assert.equal((await items.listItems(parent.id)).length, 0);
});

test("reorderPapers updates sort order", async () => {
  const { items, uc } = makeUseCase();
  const list = await uc.createList({ name: "L" });
  await uc.addPaperToList(list.id, "p1");
  await uc.addPaperToList(list.id, "p2");
  await uc.addPaperToList(list.id, "p3");
  await uc.reorderPapers(list.id, ["p3", "p1", "p2"]);
  const ordered = (await items.listItems(list.id)).map((i) => i.paperId);
  assert.deepEqual(ordered, ["p3", "p1", "p2"]);
});

test("addNoteToList is idempotent on (list, note)", async () => {
  const { items, uc } = makeUseCase();
  const first = await uc.addNoteToList("l1", "v1");
  const second = await uc.addNoteToList("l1", "v1");
  assert.equal(second.id, first.id);
  assert.equal((await items.listItems("l1")).length, 1);
});

test("removeNoteFromList deletes the membership", async () => {
  const { items, uc } = makeUseCase();
  await uc.addNoteToList("l1", "v1");
  await uc.removeNoteFromList("l1", "v1");
  assert.equal((await items.listItems("l1")).length, 0);
});

test("reorderItems supports mixed papers and notes", async () => {
  const { items, uc } = makeUseCase();
  const list = await uc.createList({ name: "L" });
  const paper = await uc.addPaperToList(list.id, "p1");
  const note = await uc.addNoteToList(list.id, "v1");
  await uc.reorderItems(list.id, [note.id, paper.id]);
  const ordered = (await items.listItems(list.id)).map((i) => i.id);
  assert.deepEqual(ordered, [note.id, paper.id]);
});

test("removeList deletes items and nested sublists", async () => {
  const { lists, items, uc } = makeUseCase();
  const root = await uc.createList({ name: "Root" });
  const child = await uc.createList({ name: "Child", parentId: root.id });
  await uc.addPaperToList(root.id, "p1");
  await uc.addPaperToList(child.id, "p2");
  await uc.removeList(root.id);
  assert.equal(await lists.getById(root.id), null);
  assert.equal(await lists.getById(child.id), null);
  assert.equal((await items.listItems(root.id)).length, 0);
  assert.equal((await items.listItems(child.id)).length, 0);
});

async function siblings() {
  const made = makeUseCase();
  const { uc } = made;
  const root = await uc.createList({ name: "Root" });
  const parent = await uc.createList({ name: "Parent", parentId: root.id });
  const a = await uc.createList({ name: "A", parentId: parent.id });
  const b = await uc.createList({ name: "B", parentId: parent.id });
  return { ...made, root, parent, a, b };
}

test("removing from one child keeps ancestor rows a sibling still holds (04-13)", async () => {
  const { items, uc, root, parent, a, b } = await siblings();
  await uc.addPaperToList(a.id, "p1");
  await uc.addPaperToList(b.id, "p1");
  await uc.removePaperFromList(a.id, "p1");

  assert.equal((await items.listItems(a.id)).length, 0);
  for (const ancestor of [parent, root]) {
    const rows = await items.listItems(ancestor.id);
    assert.equal(rows.length, 1, ancestor.name);
    assert.equal(rows[0]!.inheritedFromListId, b.id, ancestor.name);
  }
  // Removing the last holder now clears the ancestors.
  await uc.removePaperFromList(b.id, "p1");
  assert.equal((await items.listItems(parent.id)).length, 0);
  assert.equal((await items.listItems(root.id)).length, 0);
});

test("note removal keeps ancestor rows a sibling still holds (04-13)", async () => {
  const { items, uc, parent, a, b } = await siblings();
  await uc.addNoteToList(a.id, "n1");
  await uc.addNoteToList(b.id, "n1");
  await uc.removeNoteFromList(a.id, "n1");
  const rows = await items.listItems(parent.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.inheritedFromListId, b.id);
});

test("a holder outside the ancestor's subtree does not keep it (04-13)", async () => {
  const { items, uc, parent, a } = await siblings();
  const other = await uc.createList({ name: "Other" });
  await uc.addPaperToList(a.id, "p1");
  await uc.addPaperToList(other.id, "p1");
  await uc.removePaperFromList(a.id, "p1");
  assert.equal((await items.listItems(parent.id)).length, 0);
  assert.equal((await items.listItems(other.id)).length, 1);
});

test("a direct ancestor row survives a child remove", async () => {
  const { items, uc, parent, a } = await siblings();
  await uc.addPaperToList(parent.id, "p1");
  await uc.addPaperToList(a.id, "p1");
  await uc.removePaperFromList(a.id, "p1");
  const rows = await items.listItems(parent.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.inheritedFromListId, undefined);
});

function failingInheritedAdd(err: unknown) {
  const made = makeUseCase();
  const add = made.items.add.bind(made.items);
  made.items.add = async (item) => {
    if (item.inheritedFromListId) throw err;
    return add(item);
  };
  return made;
}

test("a non-schema failure on an inherited add propagates (04-14)", async () => {
  const { uc } = failingInheritedAdd(new Error("network down"));
  const parent = await uc.createList({ name: "Parent" });
  const child = await uc.createList({ name: "Child", parentId: parent.id });
  await assert.rejects(() => uc.addPaperToList(child.id, "p1"), /network down/);
  await assert.rejects(() => uc.addNoteToList(child.id, "n1"), /network down/);
});

test("a stale inherited link falls back to a plain row (04-14)", async () => {
  for (const code of ["23503", "42703", "PGRST204"]) {
    const { items, uc } = failingInheritedAdd(Object.assign(new Error("fk"), { code }));
    const parent = await uc.createList({ name: "Parent" });
    const child = await uc.createList({ name: "Child", parentId: parent.id });
    await uc.addPaperToList(child.id, "p1");
    const rows = await items.listItems(parent.id);
    assert.equal(rows.length, 1, code);
    assert.equal(rows[0]!.inheritedFromListId, undefined, code);
  }
});
