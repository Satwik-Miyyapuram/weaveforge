import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, type ReadingList } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileReadingListItemRepository, FileReadingListRepository } from "../file-reading-list-repo";

before(loadTestCore);

const ROOT = "thesis";

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(`${ROOT}/papers/paper-one.paper.md`, core.writePaperRow(null, { id: "p1", title: "Paper one" }));
  await fs.writeFile(`${ROOT}/papers/paper-two.paper.md`, core.writePaperRow(null, { id: "p2", title: "Paper two" }));
  await fs.writeFile(`${ROOT}/notes/Ünïcode note.note.md`, "---\nweaveforge-id: n1\n---\nBody\n");
  return {
    fs,
    lists: new FileReadingListRepository(fs, () => ROOT),
    items: new FileReadingListItemRepository(fs, () => ROOT),
  };
}

function list(over: Partial<ReadingList> = {}): ReadingList {
  return { id: crypto.randomUUID(), name: "Review", sortOrder: 0, createdAt: "2026-06-24T00:00:00.000Z", ...over };
}

async function listFile(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const e of fs.walk(`${ROOT}/reading-lists`)) if (e.kind === "file") out.push(e.path);
  return out;
}

test("T4: a list round-trips; unicode and duplicate names are two files", async () => {
  const { fs, lists } = await setup();
  const full = list({ name: "Ünïcode «list» / 1", description: "Why.\n\nMore.", parentId: "x", color: "#ff0000", sortOrder: 3 });
  const twin = list({ name: full.name });
  await lists.save(full);
  await lists.save(twin);
  assert.deepEqual(await lists.getById(full.id), full);
  assert.equal((await lists.getById(twin.id))?.name, full.name);
  assert.equal((await listFile(fs)).length, 2);
  assert.equal(await lists.getById("nope"), null);
});

test("list filters top level and name; orders by sortOrder then name; getTree nests", async () => {
  const { lists } = await setup();
  const b = list({ name: "B", sortOrder: 2 });
  const a = list({ name: "A", sortOrder: 1 });
  const c2 = list({ name: "C2", parentId: b.id, sortOrder: 2 });
  const c1 = list({ name: "C1", parentId: b.id, sortOrder: 1 });
  for (const l of [b, a, c2, c1]) await lists.save(l);
  assert.deepEqual((await lists.list({ parentId: null })).map((l) => l.id), [a.id, b.id]);
  assert.deepEqual((await lists.list({ parentId: b.id })).map((l) => l.id), [c1.id, c2.id]);
  assert.deepEqual((await lists.list({ nameContains: "c" })).map((l) => l.id), [c1.id, c2.id]);
  assert.equal((await lists.list()).length, 4);
  assert.deepEqual((await lists.listByIds([a.id, "nope"])).map((l) => l.id), [a.id]);
  const tree = await lists.getTree();
  assert.deepEqual(tree.map((n) => n.list.id), [a.id, b.id]);
  assert.deepEqual(tree[1]!.children.map((n) => n.list.id), [c1.id, c2.id]);
});

test("add and find keep the item's id; items order by sortOrder; members name papers by link", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 2 });
  await items.add({ id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 1, note: "key" });
  assert.deepEqual(
    (await items.listItems(l.id)).map((i) => i.id),
    ["b", "a"],
  );
  assert.equal((await items.find(l.id, "p1"))?.id, "a");
  assert.equal((await items.findNote(l.id, "n1"))?.note, "key");
  assert.equal(await items.find(l.id, "p2"), null);
  const [path] = await listFile(fs);
  const text = await fs.readText(path!);
  assert.match(text, /\[\[paper-one\.paper\]\]/);
  assert.match(text, /\[\[Ünïcode note\.note\]\]/);
  assert.doesNotMatch(text, /p1|n1/);
});

test("add upserts one membership per paper; saving the list keeps its members", async () => {
  const { lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 });
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 5, note: "moved" });
  await items.add({ id: "other", listId: l.id, paperId: "p1", sortOrder: 6 });
  const all = await items.listItems(l.id);
  assert.equal(all.length, 1);
  assert.equal(all[0]!.id, "other");
  await lists.save({ ...l, name: "Renamed" });
  assert.equal((await items.listItems(l.id)).length, 1);
  assert.equal((await lists.getById(l.id))?.name, "Renamed");
});

test("add refuses a missing list, target or inherited-from list (code 23503)", async () => {
  const { lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await assert.rejects(items.add({ id: "x", listId: "nope", paperId: "p1", sortOrder: 0 }), NotFoundError);
  await assert.rejects(items.add({ id: "x", listId: l.id, paperId: "missing", sortOrder: 0 }), NotFoundError);
  await assert.rejects(
    items.add({ id: "x", listId: l.id, paperId: "p1", sortOrder: 0, inheritedFromListId: "gone" }),
    (e: unknown) => (e as { code?: string }).code === "23503",
  );
  const child = list({ parentId: l.id });
  await lists.save(child);
  await items.add({ id: "x", listId: l.id, paperId: "p1", sortOrder: 0, inheritedFromListId: child.id, duplicateOfItemId: "y" });
  const got = await items.find(l.id, "p1");
  assert.equal(got?.inheritedFromListId, child.id);
  assert.equal(got?.duplicateOfItemId, "y");
});

test("listsForPaper / listsForNote span lists; remove drops one membership", async () => {
  const { lists, items } = await setup();
  const l1 = list({ name: "One" });
  const l2 = list({ name: "Two" });
  await lists.save(l1);
  await lists.save(l2);
  await items.add({ id: "a", listId: l1.id, paperId: "p1", sortOrder: 0 });
  await items.add({ id: "b", listId: l2.id, paperId: "p1", sortOrder: 0 });
  await items.add({ id: "c", listId: l2.id, vaultPageId: "n1", sortOrder: 1 });
  assert.deepEqual((await items.listsForPaper("p1")).map((i) => i.listId).sort(), [l1.id, l2.id].sort());
  assert.deepEqual((await items.listsForNote("n1")).map((i) => i.id), ["c"]);
  assert.equal((await items.listItemsForLists([l2.id])).length, 2);
  await items.remove("b");
  assert.deepEqual((await items.listsForPaper("p1")).map((i) => i.id), ["a"]);
  await items.remove("nope");
});

test("a hand-written member, an unresolved link and the screening items key survive", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const [path] = await listFile(fs);
  const text = await fs.readText(path!);
  const hand = text.replace(
    /^---\n/,
    '---\nmembers: ["[[Paper-Two.paper|alias]]", "[[Gone paper]]"]\nitems: [{"id":"d1","item":"[[paper-two.paper]]","reviewer":"ana","stage":"title_abstract","decision":"excluded","added":"2026-11-19T10:00:00.000Z"}]\n',
  );
  await fs.writeFile(path!, hand);
  const [only] = await items.listItems(l.id);
  assert.deepEqual(only, { id: `${l.id}:p2`, listId: l.id, paperId: "p2", sortOrder: 0 });
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 9 });
  await lists.save({ ...l, name: "Renamed" });
  const after = await fs.readText((await listFile(fs))[0]!);
  assert.match(after, /Gone paper/);
  assert.match(after, /"reviewer":"ana"|reviewer: ana/);
  assert.equal((await items.listItems(l.id)).length, 2);
  await items.remove(`${l.id}:p2`);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), ["a"]);
});

test("an empty list file reads as no members; delete moves the list to the trash", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  assert.deepEqual(await items.listItems(l.id), []);
  assert.deepEqual(await items.listItems("nope"), []);
  await lists.delete(l.id);
  assert.equal(await lists.getById(l.id), null);
  let trashed = 0;
  for await (const e of fs.walk(".weaveforge/trash")) if (e.kind === "file") trashed += 1;
  assert.equal(trashed, 1);
});
