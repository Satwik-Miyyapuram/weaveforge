import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { readMirrorBase, writeMirrorManifest } from "../application/parts-3";

// Renaming a note in the app: the file and its strokes follow the new name,
// and no second file with the same weaveforge-id is left behind. Nothing is removed.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const ID = "4e64e8a9-cb73-418a-9909-00c3507060c3";

const snapshot = (title: string): WorkspaceSnapshot => ({
  papers: [], readingLists: [], readingListItems: [], reportSections: [], experiments: [],
  milestones: [], logEntries: [], relations: [], tags: [], readerAnnotations: [], collectedAt: AT,
  vaultPages: [{ id: ID, title, body: "Body.", sortOrder: 0, createdAt: "", updatedAt: "" } as never],
});

async function mirrorRun(fs: MemoryWorkspaceFs, input: WorkspaceSnapshot, seen?: Readonly<Record<string, string>>) {
  const root = core.projectDir(PROJECT);
  const base = await readMirrorBase(fs, root);
  const result = await mirrorWorkspace(core, input, fs, { project: PROJECT, seen, base });
  await writeMirrorManifest(fs, root, Object.keys(result.mirrored), result.mirrored);
  return result;
}

const notePaths = (fs: MemoryWorkspaceFs) =>
  Object.entries(fs.toRecord())
    .filter(([path, text]) => path.endsWith(".md") && text.includes(ID))
    .map(([path]) => path);

test("an in-app rename moves the note and its strokes, leaving one file with the id", async () => {
  const fs = new MemoryWorkspaceFs(() => AT);
  const first = await mirrorRun(fs, snapshot("Method"));
  const [oldPath] = notePaths(fs);
  assert.ok(oldPath);
  const oldStrokes = core.inkStrokesDir(oldPath);
  await fs.mkdirp(oldStrokes);
  await fs.writeFile(`${oldStrokes}/01J.inkb`, new Uint8Array([1, 2, 3]));

  await mirrorRun(fs, snapshot("Methods"), first.served);

  const paths = notePaths(fs);
  assert.equal(paths.length, 1, `one file carries the id, got ${paths.join(", ")}`);
  const newPath = paths[0] ?? "";
  assert.notEqual(newPath, oldPath);
  assert.match(fs.toRecord()[newPath] ?? "", /Methods/);
  assert.deepEqual([...(await fs.readFile(`${core.inkStrokesDir(newPath)}/01J.inkb`))], [1, 2, 3]);
});

test("a rename never takes a file the reader edited", async () => {
  const fs = new MemoryWorkspaceFs(() => AT);
  const first = await mirrorRun(fs, snapshot("Method"));
  const oldPath = notePaths(fs)[0] ?? "";
  await fs.writeFile(oldPath, `${fs.toRecord()[oldPath]}\nA reader line.`);

  await mirrorRun(fs, snapshot("Methods"), first.served);

  assert.match(fs.toRecord()[oldPath] ?? "", /A reader line\./, "the edited file is kept where it is");
});

test("a rename that fails leaves no twin and is tried again on the next run", async () => {
  const fs = new MemoryWorkspaceFs(() => AT);
  const first = await mirrorRun(fs, snapshot("Method"));
  const oldPath = notePaths(fs)[0] ?? "";
  // The note file is busy once (another editor, antivirus); atomic writes still rename freely.
  let failures = 1;
  const rename = fs.rename.bind(fs);
  fs.rename = async (from: string, to: string) => {
    if (from === oldPath && failures-- > 0) throw new Error("EBUSY");
    return rename(from, to);
  };
  await fs.mkdirp(core.inkStrokesDir(oldPath));
  await fs.writeFile(`${core.inkStrokesDir(oldPath)}/01J.inkb`, new Uint8Array([1, 2, 3]));

  const second = await mirrorRun(fs, snapshot("Methods"), first.served);
  assert.deepEqual(notePaths(fs), [oldPath], "the failed rename writes no second file");

  await mirrorRun(fs, snapshot("Methods"), second.served);
  const paths = notePaths(fs);
  assert.equal(paths.length, 1, `one file carries the id, got ${paths.join(", ")}`);
  const newPath = paths[0] ?? "";
  assert.notEqual(newPath, oldPath);
  assert.match(fs.toRecord()[newPath] ?? "", /Methods/);
  assert.deepEqual([...(await fs.readFile(`${core.inkStrokesDir(newPath)}/01J.inkb`))], [1, 2, 3]);
});
