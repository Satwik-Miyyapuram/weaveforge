import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { VaultPage } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileNoteRepository } from "../file-note-repo";

before(loadTestCore);

function page(over: Partial<VaultPage> = {}): VaultPage {
  return {
    id: "n-1",
    title: "Methods",
    body: "# Methods\n\nWe measure things.\n",
    sortOrder: 0,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
    ...over,
  };
}

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileNoteRepository(fs, "thesis") };
}

async function files(fs: MemoryWorkspaceFs): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of fs.walk("")) out.push(entry.path);
  return out.sort();
}

test("note_body_round_trip: a saved note reads back unchanged", async () => {
  const { repo } = setup();
  const saved = page({ parentId: "n-0", pinned: true, sortOrder: 3 });
  await repo.save(page({ id: "n-0", title: "Chapter" }));
  await repo.save(saved);
  assert.deepEqual(await repo.getById("n-1"), saved);
});

test("note body round trip holds for awkward bodies", async () => {
  const { repo } = setup();
  const bodies = ["---\nnot: frontmatter\n---\n", "  leading space\n\n\n", "no newline", "émoji 🧵 and ``` fences\n"];
  for (const [i, body] of bodies.entries()) {
    const saved = page({ id: `n-${i}`, title: `T${i}`, body });
    await repo.save(saved);
    assert.equal((await repo.getById(saved.id))?.body, body, JSON.stringify(body));
  }
});

test("empty_note: a note with no body is one file and reads back empty", async () => {
  const { fs, repo } = setup();
  await repo.save(page({ body: "" }));
  assert.equal((await files(fs)).length, 1);
  assert.equal((await repo.getById("n-1"))?.body, "");
});

test("note_crlf_normalised_once: CRLF is stored as LF and a second save writes nothing", async () => {
  const { fs, repo } = setup();
  await repo.save(page({ body: "a\r\nb\r\n" }));
  const [path] = await files(fs);
  const first = await fs.readText(path ?? "");
  assert.ok(!first.includes("\r"));
  assert.equal((await repo.getById("n-1"))?.body, "a\nb\n");
  let writes = 0;
  const real = fs.writeTextIf.bind(fs);
  fs.writeTextIf = async (p, text, expected) => {
    writes += 1;
    return real(p, text, expected);
  };
  await repo.save(page({ body: "a\r\nb\r\n" }));
  assert.equal(writes, 0);
});

test("section_reorder_changes_order_only: a new sortOrder changes only the order line", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const [path] = await files(fs);
  const before = (await fs.readText(path ?? "")).split("\n");
  await repo.save(page({ sortOrder: 7 }));
  const after = (await fs.readText(path ?? "")).split("\n");
  assert.equal(after.length, before.length);
  const changed = after.filter((line, i) => line !== before[i]);
  assert.deepEqual(changed, ["order: 7"]);
});

test("parent_cycle: a save that makes a page its own ancestor is refused and writes nothing", async () => {
  const { fs, repo } = setup();
  await repo.save(page({ id: "a", title: "A" }));
  await repo.save(page({ id: "b", title: "B", parentId: "a" }));
  const snapshot = await Promise.all((await files(fs)).map((p) => fs.readText(p)));
  await assert.rejects(repo.save(page({ id: "a", title: "A", parentId: "b" })), /cycle/);
  await assert.rejects(repo.save(page({ id: "a", title: "A", parentId: "a" })), /cycle/);
  assert.deepEqual(await Promise.all((await files(fs)).map((p) => fs.readText(p))), snapshot);
});

test("getTree nests children under parents in sortOrder", async () => {
  const { repo } = setup();
  await repo.save(page({ id: "root", title: "Root" }));
  await repo.save(page({ id: "c2", title: "Second", parentId: "root", sortOrder: 2 }));
  await repo.save(page({ id: "c1", title: "First", parentId: "root", sortOrder: 1 }));
  await repo.save(page({ id: "orphan", title: "Orphan", parentId: "gone" }));
  const tree = await repo.getTree();
  assert.deepEqual(
    tree.map((n) => [n.page.id, n.children.map((c) => c.page.id)]),
    [["orphan", []], ["root", ["c1", "c2"]]],
  );
  assert.equal((tree[1]?.page as { body?: string }).body, undefined);
});

test("list filters by parent and by query; titleTaken ignores case and the page itself", async () => {
  const { repo } = setup();
  await repo.save(page({ id: "a", title: "Alpha", body: "about lasers" }));
  await repo.save(page({ id: "b", title: "Beta", parentId: "a" }));
  assert.deepEqual((await repo.list({ parentId: null })).map((p) => p.id), ["a"]);
  assert.deepEqual((await repo.list({ parentId: "a" })).map((p) => p.id), ["b"]);
  assert.deepEqual((await repo.list({ query: "LASER" })).map((p) => p.id), ["a"]);
  assert.equal(await repo.titleTaken("alpha"), true);
  assert.equal(await repo.titleTaken("Alpha", "a"), false);
  assert.equal(await repo.titleTaken("Gamma"), false);
});

test("a save keeps unknown fields and the path; delete moves the file to the trash", async () => {
  const { fs, repo } = setup();
  const path = "thesis/notes/old--q.note.md";
  await fs.writeFile(path, "---\nweaveforge-id: n-1\nweaveforge-type: vault_page\ntitle: Old\ntags: [x]\n---\nold\n");
  await repo.save(page({ title: "New" }));
  assert.deepEqual(await files(fs), [path]);
  assert.match(await fs.readText(path), /tags:/);
  const text = await fs.readText(path);
  await repo.delete("n-1");
  assert.equal(await fs.stat(path), null, "the note left its folder");
  assert.equal(await repo.getById("n-1"), null);
  // P1-3: a deleted note is recoverable, as a deleted paper is.
  const trash: string[] = [];
  for await (const entry of fs.walk(".weaveforge/trash")) trash.push(entry.path);
  assert.equal(trash.length, 1, trash.join(", "));
  assert.equal(await fs.readText(trash[0]!), text);
});

test("a file changed between read and write is not overwritten", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const [path] = await files(fs);
  const real = fs.writeTextIf.bind(fs);
  fs.writeTextIf = async (p, text, expected) => {
    await fs.writeFile(p, "---\nweaveforge-id: n-1\nweaveforge-type: vault_page\ntitle: Theirs\n---\n");
    return real(p, text, expected);
  };
  await assert.rejects(repo.save(page({ body: "mine\n" })), /changed on disk/);
  assert.match(await fs.readText(path ?? ""), /Theirs/);
});

test("a save from a stale page keeps the outside edit and puts the page in a conflict copy", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  const [path] = await files(fs);
  const theirs = (await fs.readText(path ?? "")).replace("We measure things.", "They edited this.");
  await fs.writeFile(path ?? "", theirs);
  await assert.rejects(repo.save({ ...loaded, body: "mine\n" }), { name: "ConflictError" });
  assert.equal(await fs.readText(path ?? ""), theirs, "the outside edit is kept");
  const all = await repo.list();
  assert.equal(all.length, 2);
  const copy = all.find((p) => p.id !== "n-1")!;
  assert.match(copy.title, /^Methods \(conflict copy /);
  assert.equal(copy.body, "mine\n");
  // After a fresh read the save goes through.
  const fresh = (await repo.getById("n-1"))!;
  await repo.save({ ...fresh, body: "mine\n" });
  assert.equal((await repo.getById("n-1"))?.body, "mine\n");
});

/** Loads the note, then edits its body on disk as another writer would; returns the page as loaded. */
async function editedOutside(fs: MemoryWorkspaceFs, repo: FileNoteRepository): Promise<VaultPage> {
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  const [path] = await files(fs);
  await fs.writeFile(path ?? "", (await fs.readText(path ?? "")).replace("We measure things.", "They edited this."));
  return loaded;
}

test("a stale save with its base conflicts even after an unrelated read", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  await repo.list();
  await assert.rejects(repo.save({ ...loaded, body: "mine\n" }, loaded), { name: "ConflictError" });
  assert.equal((await repo.list()).length, 2);
  assert.match((await repo.getById("n-1"))!.body, /They edited this/);
});

test("three retries of a stale save leave exactly one conflict copy", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(repo.save({ ...loaded, body: "mine\n" }, loaded), { name: "ConflictError" });
  }
  const copies = (await repo.list()).filter((p) => p.id !== "n-1");
  assert.equal(copies.length, 1);
  assert.equal(copies[0]?.body, "mine\n");
});

test("a retry with new content updates the one conflict copy", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  await assert.rejects(repo.save({ ...loaded, body: "mine\n" }, loaded), { name: "ConflictError" });
  await assert.rejects(repo.save({ ...loaded, body: "mine, more\n" }, loaded), { name: "ConflictError" });
  const copies = (await repo.list()).filter((p) => p.id !== "n-1");
  assert.equal(copies.length, 1);
  assert.equal(copies[0]?.body, "mine, more\n");
});

test("a conflict copy edited since is kept and a retry writes a new copy", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  await assert.rejects(repo.save({ ...loaded, body: "mine\n" }, loaded), { name: "ConflictError" });
  const first = (await repo.list()).find((p) => p.id !== "n-1")!;
  const firstPath = (await repo.pathOf(first.id))!;
  await fs.writeFile(firstPath, (await fs.readText(firstPath)).replace("mine", "user kept this"));
  await assert.rejects(repo.save({ ...loaded, body: "mine, more\n" }, loaded), { name: "ConflictError" });
  assert.equal((await repo.list()).filter((p) => p.id !== "n-1").length, 2);
  assert.match(await fs.readText(firstPath), /user kept this/);
});

test("a save whose base matches the file goes through", async () => {
  const { repo } = setup();
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  await repo.save({ ...loaded, body: "mine\n" }, loaded);
  assert.equal((await repo.getById("n-1"))?.body, "mine\n");
  assert.equal((await repo.list()).length, 1);
});

test("a page edited outside only in keys the repo does not own saves without a conflict", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  const [path] = await files(fs);
  await fs.writeFile(path ?? "", (await fs.readText(path ?? "")).replace("title:", "tags: [x]\ntitle:"));
  await repo.save({ ...loaded, body: "mine\n" });
  assert.equal((await repo.list()).length, 1);
  assert.match(await fs.readText(path ?? ""), /tags:/);
  assert.equal((await repo.getById("n-1"))?.body, "mine\n");
});

test("a filesystem without a checked write refuses the save rather than overwrite unchecked", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const [path] = await files(fs);
  const before = await fs.readText(path ?? "");
  (fs as { writeTextIf?: unknown }).writeTextIf = undefined;
  await assert.rejects(repo.save(page({ body: "mine\n" })));
  assert.equal(await fs.readText(path ?? ""), before);
});

test("canvas pages are refused: they live in .canvas files", async () => {
  const { fs, repo } = setup();
  await assert.rejects(repo.save(page({ kind: "canvas", body: "{}" })), /canvas/);
  assert.deepEqual(await files(fs), []);
});

// --- IVaultPageManager: add / update / remove (files mode had none: HIGH 1) ---

const UUID = "0b7f3c1e-2a4d-4c8e-9f10-123456789abc";

test("add writes a note file with a trimmed title, order 0 and the given body", async () => {
  const { fs, repo } = setup();
  const added = await repo.add({ title: "  Results  ", body: "r\n" });
  assert.equal(added.title, "Results");
  assert.equal(added.sortOrder, 0);
  assert.match(added.id, /^[0-9a-f-]{36}$/);
  assert.equal(added.createdAt, added.updatedAt);
  assert.deepEqual(await repo.getById(added.id), added);
  assert.equal((await files(fs)).length, 1);
});

test("add keeps parent, folder, sortOrder, a given uuid id and a dated createdAt", async () => {
  const { repo } = setup();
  const parent = await repo.add({ title: "Chapter" });
  const added = await repo.add({
    title: "Child",
    parentId: parent.id,
    folder: true,
    sortOrder: 4,
    id: UUID,
    createdAt: "2025-01-02T03:04:05Z",
  });
  assert.equal(added.id, UUID);
  assert.equal(added.parentId, parent.id);
  assert.equal(added.folder, true);
  assert.equal(added.sortOrder, 4);
  assert.equal(added.createdAt, "2025-01-02T03:04:05Z");
  assert.deepEqual(await repo.getById(UUID), added);
});

test("add refuses a blank title, a taken title (any case), a bad id, a taken id and canvas; writes nothing", async () => {
  const { fs, repo } = setup();
  await repo.add({ title: "Methods", id: UUID });
  const before = await files(fs);
  await assert.rejects(repo.add({ title: "   " }), /title is required/);
  await assert.rejects(repo.add({ title: "methods" }), /already exists/);
  await assert.rejects(repo.add({ title: "Other", id: "../evil" }), /not a valid id/);
  await assert.rejects(repo.add({ title: "Other", id: UUID }), /already has the id/);
  await assert.rejects(repo.add({ title: "Board", kind: "canvas" }), /canvas/);
  assert.deepEqual(await files(fs), before);
});

test("add ignores a createdAt that is not a date", async () => {
  const { repo } = setup();
  const added = await repo.add({ title: "X", createdAt: "yesterday" });
  assert.equal(added.createdAt, added.updatedAt);
});

test("update renames, edits the body, sets and clears parent and pinned", async () => {
  const { repo } = setup();
  const parent = await repo.add({ title: "Chapter" });
  const note = await repo.add({ title: "Draft", body: "old\n" });
  const moved = await repo.update(note.id, { title: " Final ", body: "new\n", parentId: parent.id, pinned: true });
  assert.equal(moved.title, "Final");
  assert.equal(moved.body, "new\n");
  assert.equal(moved.parentId, parent.id);
  assert.equal(moved.pinned, true);
  assert.equal(moved.conflictCopyId, undefined);
  assert.deepEqual(await repo.getById(note.id), { ...moved });
  const cleared = await repo.update(note.id, { parentId: null, pinned: false });
  assert.equal(cleared.parentId, undefined);
  assert.equal(cleared.pinned, undefined);
  assert.equal((await repo.getById(note.id))?.parentId, undefined);
});

test("update lets a note change the case of its own title", async () => {
  const { repo } = setup();
  const note = await repo.add({ title: "draft" });
  assert.equal((await repo.update(note.id, { title: "Draft" })).title, "Draft");
});

test("update refuses a missing note, blank title, another note's title, a missing parent and a cycle", async () => {
  const { fs, repo } = setup();
  const a = await repo.add({ title: "A" });
  const b = await repo.add({ title: "B", parentId: a.id });
  const snapshot = await Promise.all((await files(fs)).map((p) => fs.readText(p)));
  await assert.rejects(repo.update("nope", { title: "X" }), /No vault page with id "nope"/);
  await assert.rejects(repo.update(a.id, { title: "  " }), /title is required/);
  await assert.rejects(repo.update(a.id, { title: "b" }), /already exists/);
  await assert.rejects(repo.update(a.id, { parentId: "gone" }), /No vault page with id "gone"/);
  await assert.rejects(repo.update(a.id, { parentId: a.id }), /inside itself/);
  await assert.rejects(repo.update(a.id, { parentId: b.id }), /inside itself/);
  assert.deepEqual(await Promise.all((await files(fs)).map((p) => fs.readText(p))), snapshot);
});

test("update with nothing changed writes nothing", async () => {
  const { fs, repo } = setup();
  const note = await repo.add({ title: "Same", body: "b\n" });
  let writes = 0;
  const real = fs.writeTextIf.bind(fs);
  fs.writeTextIf = async (p, text, expected) => {
    writes += 1;
    return real(p, text, expected);
  };
  const same = await repo.update(note.id, { title: "Same", body: "b\n" });
  assert.equal(writes, 0);
  assert.deepEqual(same, note);
});

test("guarded update: theirs equal to base or mine, or a session digest, writes mine with no copy", async () => {
  const { fs, repo } = setup();
  const note = await repo.add({ title: "G", body: "base\n" });
  const a = await repo.update(note.id, { body: "mine\n", baseBody: "base\n" });
  assert.equal(a.body, "mine\n");
  assert.equal(a.conflictCopyId, undefined);
  const b = await repo.update(note.id, { body: "mine\n", baseBody: "stale\n" });
  assert.equal(b.conflictCopyId, undefined);
  const { readyCore } = await import("@/lib/rust-core");
  const c = await repo.update(note.id, {
    body: "mine 2\n",
    baseBody: "stale\n",
    sessionDigests: [readyCore().digestText("mine\n")],
  });
  assert.equal(c.body, "mine 2\n");
  assert.equal(c.conflictCopyId, undefined);
  assert.equal((await files(fs)).length, 1);
});

test("guarded update: an outside edit is kept as a conflict copy, then mine is written", async () => {
  const { repo } = setup();
  const note = await repo.add({ title: "Clash", body: "base\n", sortOrder: 2 });
  await repo.update(note.id, { body: "theirs\n" });
  const saved = await repo.update(note.id, { body: "mine\n", baseBody: "base\n" });
  assert.equal(saved.body, "mine\n");
  assert.ok(saved.conflictCopyId);
  assert.deepEqual(saved.conflictCopyIds, [saved.conflictCopyId]);
  const copy = await repo.getById(saved.conflictCopyId!);
  assert.equal(copy?.body, "theirs\n");
  assert.match(copy?.title ?? "", /^Clash \(conflict copy \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)$/);
  assert.equal(copy?.sortOrder, 2);
  assert.equal((await repo.getById(note.id))?.body, "mine\n");
});

test("guarded update: a taken conflict-copy title gets the copy id as a tag", async () => {
  const fs = new MemoryWorkspaceFs();
  const repo = new FileNoteRepository(fs, "thesis", () => "2026-11-23T10:00:00.000Z");
  await repo.add({ title: "Tag (conflict copy 2026-11-23 10:00:00)" });
  const note = await repo.add({ title: "Tag", body: "base\n" });
  await repo.update(note.id, { body: "theirs\n" });
  const saved = await repo.update(note.id, { body: "mine\n", baseBody: "base\n" });
  const copy = await repo.getById(saved.conflictCopyId!);
  assert.equal(copy?.title, `Tag (conflict copy 2026-11-23 10:00:00) ${saved.conflictCopyId!.slice(0, 8)}`);
  assert.equal(copy?.body, "theirs\n");
});

test("guarded update: a file changed between read and write becomes a copy, never a silent overwrite", async () => {
  const { fs, repo } = setup();
  const note = await repo.add({ title: "Race", body: "base\n" });
  const [path] = await files(fs);
  const real = fs.writeTextIf.bind(fs);
  let raced = false;
  fs.writeTextIf = async (p, text, expected) => {
    if (!raced && p === path) {
      raced = true;
      const current = await fs.readText(p);
      await fs.writeFile(p, current.replace("base\n", "theirs\n"));
    }
    return real(p, text, expected);
  };
  const saved = await repo.update(note.id, { body: "mine\n", baseBody: "base\n" });
  assert.equal(saved.body, "mine\n");
  assert.ok(saved.conflictCopyId, "the racing edit was kept");
  assert.equal((await repo.getById(saved.conflictCopyId!))?.body, "theirs\n");
  assert.equal((await repo.getById(note.id))?.body, "mine\n");
});

test("unguarded update: a file changed between read and write is refused, not overwritten", async () => {
  const { fs, repo } = setup();
  const note = await repo.add({ title: "Race", body: "base\n" });
  const [path] = await files(fs);
  const real = fs.writeTextIf.bind(fs);
  fs.writeTextIf = async (p, text, expected) => {
    const current = await fs.readText(p);
    await fs.writeFile(p, current.replace("base\n", "theirs\n"));
    return real(p, text, expected);
  };
  await assert.rejects(repo.update(note.id, { body: "mine\n" }), /changed on disk/);
  assert.match(await fs.readText(path ?? ""), /theirs/);
});

test("remove moves the note file to the trash", async () => {
  const { fs, repo } = setup();
  const note = await repo.add({ title: "Gone" });
  await repo.remove(note.id);
  assert.equal(await repo.getById(note.id), null);
  const trash: string[] = [];
  for await (const entry of fs.walk(".weaveforge/trash")) trash.push(entry.path);
  assert.equal(trash.length, 1);
});

test("a rename through withRenameLinkRewrite rewrites [[Old]] in another note file", async () => {
  const { withRenameLinkRewrite } = await import("@/features/vault/application/rename-updates-links");
  const { repo } = setup();
  const target = await repo.add({ title: "Old" });
  const linker = await repo.add({ title: "Linker", body: "see [[Old]]\n" });
  const pages = withRenameLinkRewrite(repo);
  await pages.update(target.id, { title: "New" });
  assert.equal((await repo.getById(linker.id))?.body, "see [[New]]\n");
});

test("add refuses a parentId no note has, as update does, and writes nothing", async () => {
  const { fs, repo } = setup();
  await assert.rejects(repo.add({ title: "Child", body: "", parentId: "missing" }), /No vault page with id "missing"/);
  assert.deepEqual(await files(fs), []);
  const parent = await repo.add({ title: "Parent", body: "" });
  const child = await repo.add({ title: "Child", body: "", parentId: parent.id });
  assert.equal(child.parentId, parent.id);
});
test("two stale saves from different bases leave two conflict copies", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  await assert.rejects(repo.save({ ...loaded, body: "first\n" }, loaded), { name: "ConflictError" });
  const other = { ...loaded, body: "a later base\n" };
  await assert.rejects(repo.save({ ...loaded, body: "second\n" }, other), { name: "ConflictError" });
  const bodies = (await repo.list()).filter((p) => p.id !== "n-1").map((p) => p.body).sort();
  assert.deepEqual(bodies, ["first\n", "second\n"]);
});

test("a conflict copy carries the saved title; a retry with another title writes its own copy", async () => {
  const { fs, repo } = setup();
  const loaded = await editedOutside(fs, repo);
  await assert.rejects(repo.save({ ...loaded, title: "Results", body: "mine\n" }, loaded), { name: "ConflictError" });
  await assert.rejects(repo.save({ ...loaded, title: "Findings", body: "mine\n" }, loaded), { name: "ConflictError" });
  const titles = (await repo.list()).filter((p) => p.id !== "n-1").map((p) => p.title).sort();
  assert.equal(titles.length, 2);
  assert.match(titles[0] ?? "", /^Findings \(conflict copy /);
  assert.match(titles[1] ?? "", /^Results \(conflict copy /);
});

test("two quick saves, each based on the one before, both go through", async () => {
  const { repo } = setup();
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  const first = { ...loaded, body: "one\n" };
  await repo.save(first, loaded);
  await repo.save({ ...first, body: "two\n" }, first);
  assert.equal((await repo.getById("n-1"))?.body, "two\n");
  assert.equal((await repo.list()).length, 1);
});

test("save: a file changed between read and write keeps both, mine in a conflict copy", async () => {
  const { fs, repo } = setup();
  await repo.save(page());
  const loaded = (await repo.getById("n-1"))!;
  const [path] = await files(fs);
  const real = fs.writeTextIf.bind(fs);
  let raced = false;
  fs.writeTextIf = async (p, text, expected) => {
    if (!raced && p === path) {
      raced = true;
      await fs.writeFile(p, (await fs.readText(p)).replace("We measure things.", "They edited this."));
    }
    return real(p, text, expected);
  };
  await assert.rejects(repo.save({ ...loaded, body: "mine\n" }, loaded), { name: "ConflictError" });
  assert.match((await repo.getById("n-1"))!.body, /They edited this/);
  const copies = (await repo.list()).filter((p) => p.id !== "n-1");
  assert.deepEqual(copies.map((p) => p.body), ["mine\n"]);
});