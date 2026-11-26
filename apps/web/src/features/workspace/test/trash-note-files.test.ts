import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { readMirrorBase, writeMirrorManifest } from "../application/parts-3";
import { folderTrash, trashNoteFiles } from "../application/trash-note-files";

// A note deleted in the app leaves the folder: its file and its ink pages go to
// `.weaveforge/trash`, and the manifest forgets the path, so no import offers it back.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const GONE = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const KEPT = "0b0e3c1e-8f4a-4b51-9d0e-7d3f1c2a9b11";

const note = (id: string, title: string) =>
  ({ id, title, body: "Body.", sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

const snapshot: WorkspaceSnapshot = {
  papers: [], readingLists: [], readingListItems: [], reportSections: [], experiments: [],
  milestones: [], logEntries: [], relations: [], tags: [], readerAnnotations: [], collectedAt: AT,
  vaultPages: [note(GONE, "Method"), note(KEPT, "Results")],
};

async function mirrored(): Promise<{ fs: MemoryWorkspaceFs; root: string; path: (id: string) => string }> {
  const fs = new MemoryWorkspaceFs(() => AT);
  const root = core.projectDir(PROJECT);
  const result = await mirrorWorkspace(core, snapshot, fs, { project: PROJECT, base: {} });
  await writeMirrorManifest(fs, root, Object.keys(result.mirrored), result.mirrored);
  const path = (id: string) => {
    const found = Object.entries(fs.toRecord()).find(([p, text]) => p.endsWith(".md") && text.includes(id));
    assert.ok(found, `note ${id} is in the folder`);
    return found[0];
  };
  return { fs, root, path };
}

test("the note's file and ink pages go to the trash, and the manifest forgets the path", async () => {
  const { fs, root, path } = await mirrored();
  const gone = path(GONE);
  const kept = path(KEPT);
  const ink = core.inkStrokesDir(gone);
  await fs.writeFile(`${ink}/01J.inkb`, new Uint8Array([1, 2, 3]));

  await trashNoteFiles(fs, root, gone, folderTrash(fs, Date.parse(AT)));

  const files = fs.toRecord();
  assert.equal(files[gone], undefined, "the note file left its place");
  assert.equal(files[`${ink}/01J.inkb`], undefined, "the ink page left its place");
  const trashed = Object.keys(files).filter((p) => p.startsWith(".weaveforge/trash/"));
  assert.ok(trashed.some((p) => (files[p] ?? "").includes(GONE)), `note in the trash, got ${trashed.join(", ")}`);
  assert.ok(trashed.some((p) => p.endsWith(".inkb")), `ink page in the trash, got ${trashed.join(", ")}`);
  assert.ok(files[kept], "the other note stays");

  const base = await readMirrorBase(fs, root);
  assert.equal(base[gone], undefined, "no base left for the deleted note");
  assert.ok(base[kept], "the other note keeps its base");
});

test("a note file already gone still clears its manifest entry", async () => {
  const { fs, root, path } = await mirrored();
  const gone = path(GONE);
  await fs.remove(gone);

  await trashNoteFiles(fs, root, gone, folderTrash(fs, Date.parse(AT)));

  assert.equal((await readMirrorBase(fs, root))[gone], undefined);
});

test("a failed trash leaves the manifest as it was and throws", async () => {
  const { fs, root, path } = await mirrored();
  const gone = path(GONE);
  const failing = async () => {
    throw new Error("locked");
  };

  await assert.rejects(trashNoteFiles(fs, root, gone, failing), /locked/);

  assert.ok(fs.toRecord()[gone], "the file stays");
  assert.ok((await readMirrorBase(fs, root))[gone], "its base stays, so the import still sees it as deleted in the app");
});

test("a folder with a subfolder goes to the trash whole, nothing left behind", async () => {
  const fs = new MemoryWorkspaceFs(() => AT);
  await fs.writeFile("x/foo.ink/01J.inkb", new Uint8Array([1]));
  await fs.writeFile("x/foo.ink/old/01K.inkb", new Uint8Array([2]));

  await folderTrash(fs, Date.parse(AT))("x/foo.ink");

  const files = Object.keys(fs.toRecord());
  assert.deepEqual(files.filter((p) => p.startsWith("x/")), [], `left behind: ${files.join(", ")}`);
  assert.equal(files.filter((p) => p.startsWith(".weaveforge/trash/") && p.endsWith(".inkb")).length, 2);
});