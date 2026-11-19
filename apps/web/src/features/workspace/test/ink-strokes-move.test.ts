import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { IWorkspaceFs, WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { moveInkStrokes, type InkMoveReport } from "../application/ink-strokes-move";
import { mirrorWorkspace } from "../application/parts-2";
import { readMirrorBase, writeMirrorManifest } from "../application/parts-3";

// An ink note's strokes sit beside its file by name (`foo.ink.md` -> `foo.ink/`).
// Renaming the note in the app writes a new file and removes the old one; the
// strokes folder has to follow, or the note opens blank.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const ID = "4e64e8a9-0a3c-4c43-9d2b-6f0f3a1b2c3d";
const PAGE = "01JD0000000000000000000001.inkb";

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const inkNote = (title: string) => snapshot({
  vaultPages: [{
    id: ID, title, sortOrder: 0, createdAt: "", updatedAt: "",
    body: core.writeInkNoteBody(core.defaultInkNoteMeta(), ""),
  } as never],
});

async function mirrorRun(fs: IWorkspaceFs, input: WorkspaceSnapshot) {
  const root = core.projectDir(PROJECT);
  const base = await readMirrorBase(fs, root);
  const result = await mirrorWorkspace(core, input, fs, { project: PROJECT, previousPaths: Object.keys(base), base });
  await writeMirrorManifest(fs, root, Object.keys(result.mirrored), result.mirrored);
  return result;
}

const inkPath = (fs: MemoryWorkspaceFs) => {
  const path = Object.keys(fs.toRecord()).find((p) => p.endsWith(".ink.md"));
  assert.ok(path, "the note is written as an .ink.md");
  return path as string;
};

const strokes = (notePath: string) => notePath.replace(/\.md$/, "");
const bytes = new Uint8Array([1, 2, 3, 250]);

/** A folder with the note mirrored once and one page of strokes beside it. */
async function setUp() {
  const fs = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(fs, inkNote("Sketch"));
  const oldPath = inkPath(fs);
  await fs.mkdirp(strokes(oldPath));
  await fs.writeFile(`${strokes(oldPath)}/${PAGE}`, bytes);
  await fs.writeFile(`${strokes(oldPath)}/migrated`, "");
  return { fs, oldPath };
}

test("renaming an ink note in the app moves its strokes folder with it", async () => {
  const { fs, oldPath } = await setUp();
  await mirrorRun(fs, inkNote("Sketch renamed"));
  const newPath = inkPath(fs);
  assert.notEqual(newPath, oldPath);
  assert.equal(await fs.stat(oldPath), null, "the old note file is gone");
  assert.deepEqual(await fs.readFile(`${strokes(newPath)}/${PAGE}`), bytes);
  assert.ok(await fs.stat(`${strokes(newPath)}/migrated`));
  assert.equal(await fs.stat(strokes(oldPath)), null, "the old strokes folder is gone");
});

test("a rename with no strokes folder writes no strokes folder", async () => {
  const fs = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(fs, inkNote("Sketch"));
  await mirrorRun(fs, inkNote("Sketch renamed"));
  assert.equal(await fs.stat(strokes(inkPath(fs))), null);
});

test("an existing folder at the new name is never overwritten; the old note is kept", async () => {
  const { fs, oldPath } = await setUp();
  const reports: InkMoveReport[] = [];
  const newPath = oldPath.replace("sketch.ink.md", "other.ink.md");
  await fs.writeFile(`${strokes(newPath)}/${PAGE}`, new Uint8Array([9]));
  const written = { [newPath]: await fs.readText(oldPath) };
  const kept = await moveInkStrokes(core, fs, written, [oldPath], (r) => reports.push(r));
  assert.deepEqual(kept, [oldPath]);
  assert.deepEqual(await fs.readFile(`${strokes(newPath)}/${PAGE}`), new Uint8Array([9]));
  assert.deepEqual(await fs.readFile(`${strokes(oldPath)}/${PAGE}`), bytes);
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.level, "error");
});

/** `fs` with some of its methods replaced. */
function withFs(fs: MemoryWorkspaceFs, overrides: Partial<IWorkspaceFs>): IWorkspaceFs {
  return new Proxy(fs, {
    get(target, key) {
      const override = (overrides as Record<PropertyKey, unknown>)[key];
      if (override) return override;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** `fs` as a Windows or macOS disk sees it: a path that differs only in case is the same entry. */
function caseInsensitive(fs: MemoryWorkspaceFs): IWorkspaceFs {
  return withFs(fs, {
    stat: async (path) => {
      const exact = await fs.stat(path);
      if (exact) return exact;
      const lower = path.toLowerCase();
      const hit = Object.keys(fs.toRecord()).find((p) => p.toLowerCase() === lower || p.toLowerCase().startsWith(`${lower}/`));
      if (!hit) return null;
      return hit.toLowerCase() === lower ? fs.stat(hit) : { path, size: 0, modifiedAt: AT, kind: "dir" };
    },
  });
}

const filesIn = (fs: MemoryWorkspaceFs, dir: string) =>
  Object.keys(fs.toRecord()).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)).sort();

test("a failed copy removes only what it wrote and keeps the old note and strokes", async () => {
  const { fs, oldPath } = await setUp();
  const newPath = oldPath.replace("sketch.ink.md", "other.ink.md");
  const failing = withFs(fs, {
    writeFile: async (path: string, data: Uint8Array | string) => {
      if (path.includes("/migrated")) throw new Error("disk full");
      return fs.writeFile(path, data);
    },
  });
  const reports: InkMoveReport[] = [];
  const kept = await moveInkStrokes(core, failing, { [newPath]: await fs.readText(oldPath) }, [oldPath], (r) => reports.push(r));
  assert.deepEqual(kept, [oldPath]);
  assert.equal(await fs.stat(strokes(newPath)), null, "the half copy is removed");
  assert.deepEqual(await fs.readFile(`${strokes(oldPath)}/${PAGE}`), bytes);
  assert.match(reports[0]?.detail ?? "", /disk full/);
});

test("a removal that fails after every page is copied never deletes the copy; the leftover is reported", async () => {
  const { fs, oldPath } = await setUp();
  const newPath = oldPath.replace("sketch.ink.md", "other.ink.md");
  const locked = withFs(fs, {
    remove: async (path: string, options?: { recursive?: boolean }) => {
      if (path.endsWith(PAGE)) throw new Error("EBUSY: OneDrive has the file open");
      return fs.remove(path, options);
    },
  });
  const reports: InkMoveReport[] = [];
  const kept = await moveInkStrokes(core, locked, { [newPath]: await fs.readText(oldPath) }, [oldPath], (r) => reports.push(r));
  assert.deepEqual(kept, [], "every page is safe beside the new name, so the old note may go");
  assert.deepEqual(await fs.readFile(`${strokes(newPath)}/${PAGE}`), bytes);
  assert.deepEqual(filesIn(fs, strokes(newPath)), [PAGE, "migrated"]);
  assert.deepEqual(await fs.readFile(`${strokes(oldPath)}/${PAGE}`), bytes, "the locked leftover stays");
  assert.ok(reports.some((r) => r.level === "warn" && /EBUSY/.test(r.detail ?? "")));
  assert.ok(!reports.some((r) => r.level === "error"));
});

test("a move cut off half way resumes: pages already copied are checked, the rest follow", async () => {
  const { fs, oldPath } = await setUp();
  const newPath = oldPath.replace("sketch.ink.md", "other.ink.md");
  // The app stopped after the first page was copied and while the marker was being written.
  await fs.writeFile(`${strokes(newPath)}/${PAGE}`, bytes);
  await fs.writeFile(`${strokes(newPath)}/migrated.part`, "half");
  const reports: InkMoveReport[] = [];
  const kept = await moveInkStrokes(core, fs, { [newPath]: await fs.readText(oldPath) }, [oldPath], (r) => reports.push(r));
  assert.deepEqual(kept, []);
  assert.deepEqual(filesIn(fs, strokes(newPath)), [PAGE, "migrated"]);
  assert.deepEqual(filesIn(fs, strokes(oldPath)), []);
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
});

test("a case-only rename moves the strokes, even on a disk that ignores case", async () => {
  const { fs, oldPath } = await setUp();
  const newPath = oldPath.replace("sketch.ink.md", "Sketch.ink.md");
  const reports: InkMoveReport[] = [];
  const kept = await moveInkStrokes(core, caseInsensitive(fs), { [newPath]: await fs.readText(oldPath) }, [oldPath], (r) => reports.push(r));
  assert.deepEqual(kept, []);
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
  assert.deepEqual(filesIn(fs, strokes(newPath)), [PAGE, "migrated"]);
  assert.deepEqual(filesIn(fs, strokes(oldPath)), []);
});

test("the mirror keeps an old note whose strokes could not move, so the next sync retries", async () => {
  const { fs, oldPath } = await setUp();
  const scratch = new MemoryWorkspaceFs(() => AT);
  await mirrorRun(scratch, inkNote("Sketch renamed"));
  const newName = inkPath(scratch);
  await fs.writeFile(`${strokes(newName)}/${PAGE}`, new Uint8Array([9]));
  const result = await mirrorRun(fs, inkNote("Sketch renamed"));
  assert.ok(await fs.stat(oldPath), "the old note file stays on disk");
  assert.ok(!result.removed.includes(oldPath));
  assert.ok(Object.hasOwn(result.mirrored, oldPath), "still in the manifest, so the next run removes it again");
  assert.deepEqual(await fs.readFile(`${strokes(oldPath)}/${PAGE}`), bytes);
});

test("deleting an ink note leaves its strokes folder on disk", async () => {
  const { fs, oldPath } = await setUp();
  await mirrorRun(fs, snapshot());
  assert.equal(await fs.stat(oldPath), null);
  assert.deepEqual(await fs.readFile(`${strokes(oldPath)}/${PAGE}`), bytes);
});
