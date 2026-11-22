import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, type ReadingList } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileReadingListItemRepository, FileReadingListRepository } from "../file-reading-list-repo";
import { objectOf } from "../reading-list-tags";

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

/** The `[[list file name]]` link a member file carries in its `lists` tag. */
async function listLink(fs: MemoryWorkspaceFs): Promise<string> {
  const [path] = await listFile(fs);
  return `[[${path!.split("/").pop()!.slice(0, -".md".length)}]]`;
}

function frontmatterOf(text: string): Record<string, unknown> {
  return typedCore().readFrontmatter(text).frontmatter as Record<string, unknown>;
}

function tagsOf(text: string): unknown {
  return frontmatterOf(text).lists;
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

test("add and find keep the item's id; items order by sortOrder; each member carries a lists tag", async () => {
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
  assert.deepEqual(tagsOf(await fs.readText(`${ROOT}/papers/paper-one.paper.md`)), [await listLink(fs)]);
  assert.deepEqual(tagsOf(await fs.readText(`${ROOT}/notes/Ünïcode note.note.md`)), [await listLink(fs)]);
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

test("deleting the list an item is inherited from clears its from, as on delete set null", async () => {
  const { lists, items } = await setup();
  const l = list();
  const child = list({ parentId: l.id });
  await lists.save(l);
  await lists.save(child);
  await items.add({ id: "x", listId: l.id, paperId: "p1", sortOrder: 0, inheritedFromListId: child.id });
  await lists.delete(child.id);
  assert.deepEqual(await items.listItems(l.id), [{ id: "x", listId: l.id, paperId: "p1", sortOrder: 0 }]);
  assert.deepEqual(await items.listsForPaper("p1"), [{ id: "x", listId: l.id, paperId: "p1", sortOrder: 0 }]);
  assert.deepEqual(await items.listItemsForLists([l.id]), [{ id: "x", listId: l.id, paperId: "p1", sortOrder: 0 }]);
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
  await assert.rejects(items.remove(`${l.id}:p2`), /read-only/);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), [`${l.id}:p2`, "a"]);
});

test("a membership is a lists tag on the member; its id, order and note sit in list-notes", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 4, note: "key", duplicateOfItemId: "y" });
  const fm = frontmatterOf(await fs.readText(`${ROOT}/notes/Ünïcode note.note.md`));
  assert.deepEqual(fm.lists, [await listLink(fs)]);
  // The codec reads a mapping back as its JSON text; objectOf is the app's reader for it.
  assert.deepEqual(objectOf(fm["list-notes"]), { [l.id]: { id: "b", order: 4, note: "key", "duplicate-of": "y" } });
});

test("a note renamed outside the app keeps its item; the tag travels with the file", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 4, note: "key" });
  // What Obsidian does on a rename: move the file (its lists tag moves with it).
  const note = await fs.readText(`${ROOT}/notes/Ünïcode note.note.md`);
  await fs.writeFile(`${ROOT}/notes/Renamed note.note.md`, note);
  await fs.remove(`${ROOT}/notes/Ünïcode note.note.md`);
  assert.deepEqual(await items.listItems(l.id), [
    { id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 4, note: "key" },
  ]);
});

test("an older object-form member still reads, and the next write makes it a plain link", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const path = (await listFile(fs))[0]!;
  await fs.writeFile(
    path,
    (await fs.readText(path)).replace(
      /^---\n/,
      '---\nmembers:\n  - {"link":"[[paper-one.paper]]","id":"a","order":3,"note":"old","from":"' + l.id + '"}\n',
    ),
  );
  assert.deepEqual(await items.listItems(l.id), [
    { id: "a", listId: l.id, paperId: "p1", sortOrder: 3, note: "old", inheritedFromListId: l.id },
  ]);
  await items.add({ id: "c", listId: l.id, paperId: "p2", sortOrder: 5 });
  assert.deepEqual(tagsOf(await fs.readText(`${ROOT}/papers/paper-two.paper.md`)), [await listLink(fs)]);
  assert.match(await fs.readText(path), /"id":"a"|id: a/);
  await assert.rejects(items.remove("a"), /read-only/);
  assert.equal((await items.listItems(l.id)).length, 2);
});

test("a tag on a member overrides the legacy member for its paper", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const path = (await listFile(fs))[0]!;
  await fs.writeFile(path, (await fs.readText(path)).replace(/^---\n/, '---\nmembers: ["[[paper-one.paper]]"]\n'));
  await items.add({ id: "t", listId: l.id, paperId: "p1", sortOrder: 2 });
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), ["t"]);
  assert.match(await fs.readText(path), /members: \["\[\[paper-one\.paper\]\]"\]/);
});

test("retries a lost compare-and-set three times, then refuses without writing", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  let attempts = 0;
  fs.writeTextIf = async () => {
    attempts += 1;
    return false;
  };
  await assert.rejects(items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 }), /changed on disk/);
  assert.equal(attempts, 3);
  assert.equal(tagsOf(await fs.readText(`${ROOT}/papers/paper-one.paper.md`)), undefined);
});

test("a legacy members entry reads as a membership, and removing it is refused", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const path = (await listFile(fs))[0]!;
  const before = await fs.readText(path);
  await fs.writeFile(path, before.replace(/^---\n/, '---\nmembers: ["[[paper-one.paper]]"]\n'));
  const legacy = await fs.readText(path);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.paperId), ["p1"]);
  await assert.rejects(items.remove(`${l.id}:p1`), /read-only/);
  assert.equal(await fs.readText(path), legacy);
});

test("(P5a) a legacy members list naming one paper twice reads as one membership, the first entry", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const path = (await listFile(fs))[0]!;
  const before = await fs.readText(path);
  await fs.writeFile(
    path,
    before.replace(/^---\n/, '---\nmembers: ["[[paper-one.paper]]", "[[paper-one.paper|again]]"]\n'),
  );
  const found = await items.listItems(l.id);
  assert.deepEqual(found.map((i) => i.paperId), ["p1"], "one membership per target in a list");
  assert.equal(found[0]!.sortOrder, 0, "the first legacy entry sets the place");
});

test("(P5b) two list files sharing a basename: each list keeps its own members", async () => {
  const { fs, lists, items } = await setup();
  const l1 = list();
  const l2 = list();
  await lists.save(l1);
  await lists.save(l2);
  const paths = await listFile(fs);
  let p1 = "";
  let p2 = "";
  for (const p of paths) {
    const text = await fs.readText(p);
    if (text.includes(l1.id)) p1 = p;
    if (text.includes(l2.id)) p2 = p;
  }
  assert.ok(p1 && p2 && p1 !== p2, "one list file per list");
  // Same bare name, different folder: a `[[name]]` link is ambiguous between them.
  const basename = p1.split("/").pop()!;
  await fs.rename(p2, `${ROOT}/reading-lists/archive/${basename}`);
  await items.add({ id: "a", listId: l1.id, paperId: "p1", sortOrder: 1 });
  await items.add({ id: "b", listId: l2.id, paperId: "p2", sortOrder: 1 });
  assert.deepEqual((await items.listItems(l1.id)).map((i) => i.paperId), ["p1"]);
  assert.deepEqual((await items.listItems(l2.id)).map((i) => i.paperId), ["p2"]);
});

test("(P5c) an unreadable tagged member file fails the read with a named error, not a silent drop", async () => {
  const { fs, lists, items } = await setup();
  const l1 = list();
  await lists.save(l1);
  await items.add({ id: "a", listId: l1.id, paperId: "p1", sortOrder: 1 });
  const readText = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === `${ROOT}/papers/paper-one.paper.md`) throw new Error("EIO: read failed");
    return readText(path);
  };
  await assert.rejects(items.listItems(l1.id), /Cannot read .*paper-one\.paper\.md: EIO: read failed/);
});

test("(P3) a bare list tag written before a second same-named list appears raises a named error, not a drop", async () => {
  const { fs, lists, items } = await setup();
  const l1 = list();
  await lists.save(l1);
  await items.add({ id: "a", listId: l1.id, paperId: "p1", sortOrder: 1 });
  assert.equal((await items.listItems(l1.id)).length, 1);
  const l2 = list();
  await lists.save(l2);
  let p1 = "";
  let p2 = "";
  for (const p of await listFile(fs)) {
    const text = await fs.readText(p);
    if (text.includes(l1.id)) p1 = p;
    if (text.includes(l2.id)) p2 = p;
  }
  assert.ok(p1 && p2 && p1 !== p2, "one list file per list");
  await fs.rename(p2, `${ROOT}/reading-lists/archive/${p1.split("/").pop()!}`);
  await assert.rejects(items.listItems(l1.id), /Ambiguous list link/);
});

test("(P3) a list that vanishes between the existence check and the write is NotFoundError, not a TypeError", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  const walk = fs.walk.bind(fs);
  let listWalks = 0;
  // The first walk of the lists folder is the existence check; the second is load(). Hide the list from the second.
  fs.walk = (dir: string) => {
    const real = walk(dir);
    const hide = dir.includes("reading-lists") && ++listWalks >= 2;
    return (async function* () {
      for await (const e of real) if (!(hide && e.kind === "file")) yield e;
    })();
  };
  await assert.rejects(items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 }), NotFoundError);
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
