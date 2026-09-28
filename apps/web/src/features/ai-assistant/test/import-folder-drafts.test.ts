import assert from "node:assert/strict";
import { test } from "node:test";

import { FOLDER_DRAFTS_DIR, type FolderDraft } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@weaveforge/core/testing";

import { importFolderDrafts, importFolderDraftsOnce } from "../application/import-folder-drafts";

const draft = { kind: "edit_vault_note", tool: "suggest_note_edit", resourceId: "note-1", content: "Tighter", payload: { body: "New" } };

async function withFiles(files: Record<string, string>): Promise<MemoryWorkspaceFs> {
  const fs = new MemoryWorkspaceFs();
  for (const [name, text] of Object.entries(files)) await fs.writeFile(`${FOLDER_DRAFTS_DIR}/${name}`, text);
  return fs;
}

async function remaining(fs: MemoryWorkspaceFs): Promise<string[]> {
  return (await fs.list(FOLDER_DRAFTS_DIR).catch(() => [])).map((e) => e.path).sort();
}

test("a valid draft is queued once and its file removed", async () => {
  const fs = await withFiles({ "a.json": JSON.stringify(draft) });
  const queued: FolderDraft[] = [];
  assert.equal(await importFolderDrafts(fs, async (d) => queued.push(d)), 1);
  assert.equal(queued[0]?.kind, "edit_vault_note");
  assert.deepEqual(queued[0]?.payload, { body: "New" });
  assert.deepEqual(await remaining(fs), []);
  assert.equal(await importFolderDrafts(fs, async (d) => queued.push(d)), 0);
});

test("files that are not drafts are left in place and nothing is queued", async () => {
  const fs = await withFiles({ "bad.json": JSON.stringify({ ...draft, kind: "delete_everything" }), "notes.txt": "hi" });
  const queued: FolderDraft[] = [];
  assert.equal(await importFolderDrafts(fs, async (d) => queued.push(d)), 0);
  assert.equal(queued.length, 0);
  assert.equal((await remaining(fs)).length, 2);
});

test("a missing drafts folder imports nothing", async () => {
  assert.equal(await importFolderDrafts(new MemoryWorkspaceFs(), async () => undefined), 0);
});

test("a failed queue keeps the file for the next pass", async () => {
  const fs = await withFiles({ "a.json": JSON.stringify(draft) });
  await assert.rejects(importFolderDrafts(fs, async () => { throw new Error("offline"); }));
  assert.equal((await remaining(fs)).length, 1);
});

test("overlapping runs never queue the same draft twice", async () => {
  const fs = await withFiles({ "a.json": JSON.stringify(draft), "b.json": JSON.stringify({ ...draft, resourceId: "note-2" }) });
  const queued: string[] = [];
  const queue = async (d: FolderDraft) => {
    await new Promise((r) => setTimeout(r, 5));
    queued.push(d.resourceId);
  };
  await Promise.all([importFolderDraftsOnce(fs, queue), importFolderDraftsOnce(fs, queue)]);
  assert.deepEqual(queued.sort(), ["note-1", "note-2"]);
  assert.deepEqual(await remaining(fs), []);
});
