import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundError, type ReadingList } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readMemberFields } from "../member-frontmatter";
import { FileReadingListItemRepository, FileReadingListRepository } from "../file-reading-list-repo";

before(loadTestCore);

const ROOT = "thesis";
const P1 = `${ROOT}/papers/paper-one.paper.md`;
const P2 = `${ROOT}/papers/paper-two.paper.md`;
const N1 = `${ROOT}/notes/Ünïcode note.note.md`;

async function setup() {
  const fs = new MemoryWorkspaceFs();
  const core = typedCore();
  await fs.writeFile(P1, core.writePaperRow(null, { id: "p1", title: "Paper one" }));
  await fs.writeFile(P2, core.writePaperRow(null, { id: "p2", title: "Paper two" }));
  await fs.writeFile(N1, "---\nweaveforge-id: n1\n---\nBody\n");
  return {
    fs,
    lists: new FileReadingListRepository(fs, () => ROOT),
    items: new FileReadingListItemRepository(fs, () => ROOT),
  };
}

function list(over: Partial<ReadingList> = {}): ReadingList {
  return { id: crypto.randomUUID(), name: "Review", sortOrder: 0, createdAt: "2026-06-24T00:00:00.000Z", ...over };
}

async function listFiles(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const e of fs.walk(`${ROOT}/reading-lists`)) if (e.kind === "file") out.push(e.path);
  return out;
}

/** The `[[L]]` a member file uses for a list: the list file's name minus `.md`. */
async function linkOf(fs: MemoryWorkspaceFs, listId: string): Promise<string> {
  let path: string | undefined;
  for (const p of await listFiles(fs)) if ((await fs.readText(p)).includes(listId)) path = p;
  assert.ok(path, `no list file holds id ${listId}`);
  return `[[${path.slice(path.lastIndexOf("/") + 1, -".md".length)}]]`;
}

test("membership lives in the member's frontmatter; the list file holds no members", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "ignored", listId: l.id, paperId: "p1", sortOrder: 9, note: "key" });
  const L = await linkOf(fs, l.id);
  assert.deepEqual(readMemberFields(await fs.readText(P1)), { lists: [L], listNotes: { [L]: "key" } });
  assert.deepEqual(readMemberFields(await fs.readText(P2)), { lists: [], listNotes: {} });
  const listText = await fs.readText((await listFiles(fs))[0]!);
  assert.doesNotMatch(listText, /members|member-notes/);
});

test("listItems derives each id as <list>:<target>, orders by file path, and keeps the note", async () => {
  const { lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "x", listId: l.id, paperId: "p2", sortOrder: 0 });
  await items.add({ id: "y", listId: l.id, paperId: "p1", sortOrder: 0, note: "key" });
  assert.deepEqual(await items.listItems(l.id), [
    { id: `${l.id}:p1`, listId: l.id, paperId: "p1", sortOrder: 0, note: "key" },
    { id: `${l.id}:p2`, listId: l.id, paperId: "p2", sortOrder: 1 },
  ]);
  assert.deepEqual(await items.listItems("nope"), []);
});

test("two lists with the same name keep separate files, links and members", async () => {
  const { fs, lists, items } = await setup();
  const a = list({ name: "Review" });
  const b = list({ name: "Review" });
  await lists.save(a);
  await lists.save(b);
  assert.equal((await listFiles(fs)).length, 2, "one file per list");
  const [La, Lb] = [await linkOf(fs, a.id), await linkOf(fs, b.id)];
  assert.notEqual(La, Lb, "each list has its own link");
  await items.add({ id: "x", listId: a.id, paperId: "p1", sortOrder: 0, note: "for a" });
  await items.add({ id: "y", listId: b.id, paperId: "p2", sortOrder: 0 });
  await items.add({ id: "z", listId: b.id, vaultPageId: "n1", sortOrder: 0 });
  assert.deepEqual(await items.listItems(a.id), [{ id: `${a.id}:p1`, listId: a.id, paperId: "p1", sortOrder: 0, note: "for a" }]);
  assert.deepEqual(
    (await items.listItems(b.id)).map((i) => i.id).sort(),
    [`${b.id}:n1`, `${b.id}:p2`].sort(),
  );
  assert.deepEqual((await items.listsForPaper("p1")).map((i) => i.listId), [a.id]);
  assert.deepEqual((await items.listsForNote("n1")).map((i) => i.listId), [b.id]);
  await items.remove(`${b.id}:p2`);
  assert.deepEqual((await items.listItems(b.id)).map((i) => i.id), [`${b.id}:n1`]);
  assert.equal((await items.listItems(a.id)).length, 1, "removing from b leaves a alone");
  assert.equal((await lists.list()).filter((l) => l.name === "Review").length, 2);
});

test("add twice keeps one membership and takes the newer note", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0, note: "first" });
  await items.add({ id: "b", listId: l.id, paperId: "p1", sortOrder: 0, note: "second" });
  const L = await linkOf(fs, l.id);
  assert.deepEqual(readMemberFields(await fs.readText(P1)), { lists: [L], listNotes: { [L]: "second" } });
  assert.equal((await items.listItems(l.id)).length, 1);
});

test("remove by derived id drops that membership and the lines it leaves empty", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0, note: "k" });
  await items.add({ id: "b", listId: l.id, paperId: "p2", sortOrder: 0 });
  await items.remove(`${l.id}:p1`);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), [`${l.id}:p2`]);
  assert.doesNotMatch(await fs.readText(P1), /^(lists|list-notes):/m);
});

test("listsForPaper and listsForNote read the memberships from the member files", async () => {
  const { lists, items } = await setup();
  const a = list({ name: "A" });
  const b = list({ name: "B" });
  await lists.save(a);
  await lists.save(b);
  await items.add({ id: "1", listId: a.id, paperId: "p1", sortOrder: 0 });
  await items.add({ id: "2", listId: b.id, paperId: "p1", sortOrder: 0 });
  await items.add({ id: "3", listId: b.id, vaultPageId: "n1", sortOrder: 0 });
  assert.deepEqual((await items.listsForPaper("p1")).map((i) => i.listId).sort(), [a.id, b.id].sort());
  assert.deepEqual((await items.listsForNote("n1")).map((i) => i.listId), [b.id]);
  assert.deepEqual(await items.listsForPaper("p2"), []);
});

test("a note moved outside the app, with its frontmatter, keeps its membership", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 4, note: "key" });
  const note = await fs.readText(N1);
  await fs.writeFile(`${ROOT}/notes/Renamed note.note.md`, note);
  await fs.remove(N1);
  assert.deepEqual(await items.listItems(l.id), [
    { id: `${l.id}:n1`, listId: l.id, vaultPageId: "n1", sortOrder: 0, note: "key" },
  ]);
});

test("a renamed list keeps its file path, so its members still list it", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 });
  const before = await listFiles(fs);
  await lists.save({ ...l, name: "Renamed" });
  assert.deepEqual(await listFiles(fs), before);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), [`${l.id}:p1`]);
});

test("a caller-supplied list id is kept as the list's id", async () => {
  const { lists } = await setup();
  await lists.save(list({ id: "source-id-1", name: "From export" }));
  assert.equal((await lists.getById("source-id-1"))?.name, "From export");
});

test("the list file keeps its screening items and unknown keys through a save", async () => {
  const { fs, lists } = await setup();
  const l = list();
  await lists.save(l);
  const path = (await listFiles(fs))[0]!;
  const text = await fs.readText(path);
  const hand = text.replace(/^---\n/, '---\nitems: [{"id":"d1","item":"[[paper-two.paper]]","decision":"excluded"}]\nx-custom: "keep"\n');
  await fs.writeFile(path, hand);
  await lists.save({ ...l, name: "Renamed" });
  const after = await fs.readText(path);
  assert.match(after, /"decision":"excluded"/);
  assert.match(after, /x-custom: "keep"/);
});

test("an unrelated key in a member file survives adding and removing its membership", async () => {
  const { fs, lists, items } = await setup();
  await fs.writeFile(P1, (await fs.readText(P1)).replace(/^---\n/, '---\ncustom: "keep"\n'));
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 });
  await items.remove(`${l.id}:p1`);
  assert.match(await fs.readText(P1), /custom: "keep"/);
});

test("adding a member to a missing paper or an unknown list is refused", async () => {
  const { lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await assert.rejects(items.add({ id: "a", listId: l.id, paperId: "nope", sortOrder: 0 }), NotFoundError);
  await assert.rejects(items.add({ id: "b", listId: "missing", paperId: "p1", sortOrder: 0 }), NotFoundError);
});

test("one paper with an unreadable lists value is skipped and reported; the other papers still list", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p2", sortOrder: 0 });
  await items.add({ id: "b", listId: l.id, vaultPageId: "n1", sortOrder: 0 });
  await fs.writeFile(P1, (await fs.readText(P1)).replace("---\n", "---\nlists: [oops\n"));
  const broken = await fs.readText(P1);
  assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), [`${l.id}:n1`, `${l.id}:p2`]);
  assert.deepEqual(await items.unreadablePaths(), [P1]);
  assert.equal(await fs.readText(P1), broken);
});

test("a member file the link scan cannot read is reported, not dropped silently", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p2", sortOrder: 0 });
  const realRead = fs.readText.bind(fs);
  fs.readText = async (path: string) => {
    if (path === P1) throw new Error("EIO: read failed");
    return realRead(path);
  };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual((await items.listItems(l.id)).map((i) => i.id), [`${l.id}:p2`]);
    assert.deepEqual(await items.unreadablePaths(), [P1]);
  } finally {
    console.warn = realWarn;
  }
});

test("deleting a list hides its members; the list file goes to the trash", async () => {
  const { fs, lists, items } = await setup();
  const l = list();
  await lists.save(l);
  await items.add({ id: "a", listId: l.id, paperId: "p1", sortOrder: 0 });
  await lists.delete(l.id);
  assert.equal(await lists.getById(l.id), null);
  assert.deepEqual(await items.listItems(l.id), []);
  let trashed = 0;
  for await (const e of fs.walk(".weaveforge/trash")) if (e.kind === "file") trashed += 1;
  assert.equal(trashed, 1);
});
