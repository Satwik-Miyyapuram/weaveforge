import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { folderTrash, trashNoteFiles } from "../application/trash-note-files";

// A note deleted in the app leaves the folder: its file and its ink pages go to
// `.weaveforge/trash`; nothing else in the folder changes.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const GONE = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const KEPT = "0b0e3c1e-8f4a-4b51-9d0e-7d3f1c2a9b11";

async function twoNotes(): Promise<{ fs: MemoryWorkspaceFs; gone: string; kept: string }> {
  const fs = new MemoryWorkspaceFs(() => AT);
  const root = core.projectDir(PROJECT);
  const gone = `${root}/notes/method.md`;
  const kept = `${root}/notes/results.md`;
  await fs.writeFile(gone, `id: ${GONE}\nMethod.`);
  await fs.writeFile(kept, `id: ${KEPT}\nResults.`);
  return { fs, gone, kept };
}

test("the note's file and ink pages go to the trash; the other note stays", async () => {
  const { fs, gone, kept } = await twoNotes();
  const ink = core.inkStrokesDir(gone);
  await fs.writeFile(`${ink}/01J.inkb`, new Uint8Array([1, 2, 3]));

  await trashNoteFiles(fs, gone, folderTrash(fs, Date.parse(AT)));

  const files = fs.toRecord();
  assert.equal(files[gone], undefined, "the note file left its place");
  assert.equal(files[`${ink}/01J.inkb`], undefined, "the ink page left its place");
  const trashed = Object.keys(files).filter((p) => p.startsWith(".weaveforge/trash/"));
  assert.ok(trashed.some((p) => (files[p] ?? "").includes(GONE)), `note in the trash, got ${trashed.join(", ")}`);
  assert.ok(trashed.some((p) => p.endsWith(".inkb")), `ink page in the trash, got ${trashed.join(", ")}`);
  assert.ok(files[kept], "the other note stays");
});

test("a note file already gone is no error", async () => {
  const { fs, gone } = await twoNotes();
  await fs.remove(gone);

  await trashNoteFiles(fs, gone, folderTrash(fs, Date.parse(AT)));

  assert.equal(fs.toRecord()[gone], undefined);
});

test("a failed trash keeps the file and throws", async () => {
  const { fs, gone } = await twoNotes();
  const failing = async () => {
    throw new Error("locked");
  };

  await assert.rejects(trashNoteFiles(fs, gone, failing), /locked/);

  assert.ok(fs.toRecord()[gone], "the file stays");
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
