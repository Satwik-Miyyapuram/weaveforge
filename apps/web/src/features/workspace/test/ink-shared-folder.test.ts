import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { moveInkStrokes } from "../application/parts-1";
import { folderTrash, trashNoteFiles } from "../application/trash-note-files";

// `x/foo.md` and a legacy `x/foo.ink.md` both keep their strokes in `x/foo.ink`.
// While both notes exist, deleting or renaming one leaves that folder where it is,
// so the other note keeps its ink.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const AT = "2026-08-05T00:00:00.000Z";
const PAGE = new Uint8Array([1, 2, 3]);

async function twoNotesOneFolder() {
  const fs = new MemoryWorkspaceFs(() => AT);
  const root = core.projectDir({ id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" });
  const plain = `${root}/notes/foo.md`;
  const legacy = `${root}/notes/foo.ink.md`;
  const page = `${core.inkStrokesDir(plain)}/01J.inkb`;
  assert.equal(core.inkStrokesDir(plain), core.inkStrokesDir(legacy));
  await fs.writeFile(plain, "Plain.");
  await fs.writeFile(legacy, "Legacy.");
  await fs.writeFile(page, PAGE);
  return { fs, root, plain, legacy, page };
}

test("the shared folder names the other note", () => {
  assert.equal(core.inkStrokesDirSharer("x/foo.md"), "x/foo.ink.md");
  assert.equal(core.inkStrokesDirSharer("x/foo.ink.md"), "x/foo.md");
  assert.equal(core.inkStrokesDirSharer("x/foo.ink.ink.md"), undefined);
});

test("deleting one of two notes that share a strokes folder keeps the folder", async () => {
  const { fs, root, plain, page } = await twoNotesOneFolder();

  await trashNoteFiles(fs, root, plain, folderTrash(fs, Date.parse(AT)));

  const files = fs.toRecord();
  assert.equal(files[plain], undefined, "the note left its place");
  assert.ok(files[page], "the other note's ink page stays");
});

test("deleting the last note of a shared name still trashes the folder", async () => {
  const { fs, root, plain, legacy, page } = await twoNotesOneFolder();
  await fs.remove(legacy);

  await trashNoteFiles(fs, root, plain, folderTrash(fs, Date.parse(AT)));

  assert.equal(fs.toRecord()[page], undefined, "the ink page went to the trash");
});

test("renaming one of two notes that share a strokes folder moves no page", async () => {
  const { fs, root, plain, page } = await twoNotesOneFolder();
  const to = `${root}/notes/bar.md`;

  await moveInkStrokes(fs, plain, to);

  assert.ok(fs.toRecord()[page], "the page stays for the other note");
  assert.equal(await fs.stat(core.inkStrokesDir(to)), null, "nothing copied to the new name");
});
