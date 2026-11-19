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

test("a save keeps unknown fields and the path; delete removes the file", async () => {
  const { fs, repo } = setup();
  const path = "thesis/notes/old--q.note.md";
  await fs.writeFile(path, "---\nweaveforge-id: n-1\nweaveforge-type: vault_page\ntitle: Old\ntags: [x]\n---\nold\n");
  await repo.save(page({ title: "New" }));
  assert.deepEqual(await files(fs), [path]);
  assert.match(await fs.readText(path), /tags:/);
  await repo.delete("n-1");
  assert.deepEqual(await files(fs), []);
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

test("canvas pages are refused: they live in .canvas files", async () => {
  const { fs, repo } = setup();
  await assert.rejects(repo.save(page({ kind: "canvas", body: "{}" })), /canvas/);
  assert.deepEqual(await files(fs), []);
});
