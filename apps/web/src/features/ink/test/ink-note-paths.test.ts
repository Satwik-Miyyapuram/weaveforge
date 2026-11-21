/**
 * Ink pairs with its note by file name: `notes/foo.ink.md` keeps its pages in
 * `notes/foo.ink/`. These tests pin that pairing, the one-time copy out of the
 * old `.ink/<weaveforge-id>/` folder, and that nothing here ever deletes strokes.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { decodeInkChunk, encodeInkChunk, pageFromChunk, type InkPage } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import { inkChunkCodec, loadInkPages } from "../application/parts-1";
import { FolderInkNotes, FsInkChunkStore, type InkFolderReport } from "../infrastructure/parts";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

const ID = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const NOTE_PATH = "thesis--2a3407/notes/losses.ink.md";
const STROKES = "thesis--2a3407/notes/losses.ink";
const LEGACY = `.ink/${ID}`;

function noteText(id: string, order: readonly string[] = []): string {
  return [
    "---",
    `weaveforge-id: "${id}"`,
    "weaveforge-type: ink_page",
    `ink-pages: ${Math.max(order.length, 1)}`,
    "ink-paper: blank",
    `ink-page-order: [${order.map((chunk) => `"${chunk}"`).join(", ")}]`,
    "---",
    "",
  ].join("\n");
}

async function folderWith(files: Record<string, string | Uint8Array>): Promise<MemoryWorkspaceFs> {
  const fs = new MemoryWorkspaceFs();
  for (const [path, data] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await fs.mkdirp(dir);
    await fs.writeFile(path, data);
  }
  return fs;
}

function stores(fs: MemoryWorkspaceFs, options: ConstructorParameters<typeof FolderInkNotes>[1] = {}) {
  const reports: InkFolderReport[] = [];
  const notes = new FolderInkNotes(() => fs, { report: (entry) => reports.push(entry), ...options });
  return { notes, store: new FsInkChunkStore(() => fs, notes), reports };
}

async function filesUnder(fs: MemoryWorkspaceFs, dir: string): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  if (!(await fs.stat(dir))) return out;
  for await (const entry of fs.walk(dir)) out[entry.path] = [...(await fs.readFile(entry.path))];
  return out;
}

const bytes = (...values: number[]) => new Uint8Array(values);

test("a page is written beside the note file and found again by that name alone", async () => {
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID) });
  const { store } = stores(fs);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(1, 2));
  assert.deepEqual(Object.keys(await filesUnder(fs, STROKES)), [`${STROKES}/${page}.inkb`]);
  assert.equal(await fs.stat(LEGACY), null, "nothing is written to the old id-keyed folder");
  assert.deepEqual([...(await store.read(ID, page))!], [1, 2]);
});

test("strokes in the old id-keyed folder are never read as the note's pages once the note has its own folder", async () => {
  const page = typedCore().newInkChunkId();
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID),
    [`${STROKES}/${page}.inkb`]: bytes(5),
    [`${LEGACY}/${page}.inkb`]: bytes(9),
  });
  const { store } = stores(fs);
  assert.deepEqual([...(await store.read(ID, page))!], [5]);
});

test("a note renamed on disk keeps its strokes: the store follows the file to its new name", async () => {
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID) });
  const { store } = stores(fs);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(3));
  // A rename as the mirror does it: the note and its strokes folder move together.
  const renamed = "thesis--2a3407/notes/renamed.ink.md";
  await fs.writeFile(renamed, noteText(ID));
  await fs.remove(NOTE_PATH);
  await fs.mkdirp("thesis--2a3407/notes/renamed.ink");
  await fs.writeFile(`thesis--2a3407/notes/renamed.ink/${page}.inkb`, bytes(3));
  await fs.remove(`${STROKES}/${page}.inkb`);
  assert.deepEqual([...(await store.read(ID, page))!], [3]);
  const next = typedCore().newInkChunkId();
  await store.write(ID, next, bytes(4));
  assert.notEqual(await fs.stat(`thesis--2a3407/notes/renamed.ink/${next}.inkb`), null);
  assert.equal(await fs.stat(`${STROKES}/${next}.inkb`), null, "the old name gets nothing");
});

test("a note with no file in the folder has no strokes, and a write to it fails rather than going by id", async () => {
  const fs = await folderWith({});
  const { store } = stores(fs);
  const page = typedCore().newInkChunkId();
  assert.equal(await store.read(ID, page), null);
  assert.equal(await store.list(ID), null);
  await assert.rejects(store.write(ID, page, bytes(1)), /no file in the workspace folder/);
  assert.deepEqual(await filesUnder(fs, "thesis--2a3407"), {});
});

test("a note the mirror has not written yet is written by a folder sync, then the page lands beside it", async () => {
  const fs = await folderWith({});
  let syncs = 0;
  const { store } = stores(fs, {
    syncFolder: async () => {
      syncs += 1;
      await fs.mkdirp("thesis--2a3407/notes");
      await fs.writeFile(NOTE_PATH, noteText(ID));
    },
  });
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(6));
  assert.equal(syncs, 1);
  assert.notEqual(await fs.stat(`${STROKES}/${page}.inkb`), null);
});

test("every folder operation runs inside the folder lock", async () => {
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID) });
  let held = 0;
  let outside = 0;
  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    held += 1;
    try {
      return await fn();
    } finally {
      held -= 1;
    }
  };
  const watched = new Proxy(fs, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || !["writeFile", "remove", "mkdirp"].includes(String(key))) return value;
      return (...args: unknown[]) => {
        if (held === 0) outside += 1;
        return value.apply(target, args);
      };
    },
  });
  const notes = new FolderInkNotes(() => watched, { run, report: () => {} });
  const store = new FsInkChunkStore(() => watched, notes, run);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(1));
  await store.markMigrated(ID);
  await store.remove(ID, page);
  assert.equal(outside, 0);
});

test("a note found once is found again by its name: one stat, no listing", async () => {
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID), "thesis--2a3407/notes/other.md": noteText("other") });
  const calls: string[] = [];
  const counted = new Proxy(fs, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || !["stat", "list", "walk"].includes(String(key))) return value;
      return (...args: unknown[]) => {
        calls.push(String(key));
        return value.apply(target, args);
      };
    },
  });
  const notes = new FolderInkNotes(() => counted, { report: () => {} });
  assert.equal(await notes.pathOf(ID), NOTE_PATH);
  calls.length = 0;
  assert.equal(await notes.pathOf(ID), NOTE_PATH);
  assert.deepEqual(calls, ["stat"]);
});

test("migration copies the old folder's pages and marker beside the note, checks them, and leaves the old folder as it was", async () => {
  const [a, b] = [typedCore().newInkChunkId(), typedCore().newInkChunkId()];
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID, [a, b]),
    [`${LEGACY}/${a}.inkb`]: bytes(1, 1),
    [`${LEGACY}/${b}.inkb`]: bytes(2, 2),
    [`${LEGACY}/migrated`]: "legacy bucket ink copied into this folder\n",
  });
  const before = await filesUnder(fs, LEGACY);
  const { store, reports } = stores(fs);
  assert.deepEqual((await store.list(ID))!.sort(), [a, b].sort());
  assert.deepEqual([...(await store.read(ID, a))!], [1, 1]);
  assert.equal(await store.isMigrated(ID), true, "the bucket marker travels with the pages");
  assert.deepEqual(await filesUnder(fs, LEGACY), before, "the old folder is untouched");
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
});

test("migration never overwrites: the note's own page wins, and a copy cut off half way is finished", async () => {
  const [a, b] = [typedCore().newInkChunkId(), typedCore().newInkChunkId()];
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID),
    [`${STROKES}/${a}.inkb`]: bytes(7),
    [`${STROKES}/${b}.inkb.part`]: bytes(2),
    [`${LEGACY}/${a}.inkb`]: bytes(1),
    [`${LEGACY}/${b}.inkb`]: bytes(2, 2),
  });
  const beforeLegacy = await filesUnder(fs, LEGACY);
  const { store, reports } = stores(fs);
  assert.deepEqual((await store.list(ID))!.sort(), [a, b].sort());
  assert.deepEqual([...(await store.read(ID, a))!], [7], "a page already beside the note is never overwritten");
  assert.deepEqual([...(await store.read(ID, b))!], [2, 2]);
  assert.deepEqual(Object.keys(await filesUnder(fs, STROKES)).sort(), [`${STROKES}/${a}.inkb`, `${STROKES}/${b}.inkb`].sort());
  assert.deepEqual(await filesUnder(fs, LEGACY), beforeLegacy);
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
});

test("once copied, the old folder is never copied again, even after the note's folder is deleted", async () => {
  const a = typedCore().newInkChunkId();
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID, [a]), [`${LEGACY}/${a}.inkb`]: bytes(1) });
  const { store } = stores(fs);
  assert.deepEqual(await store.list(ID), [a]);
  // The user throws the strokes away on purpose.
  await fs.remove(STROKES, { recursive: true });
  const again = stores(fs);
  assert.deepEqual(await again.store.list(ID), []);
  assert.equal(await fs.stat(STROKES), null, "the stale pages do not come back");
  assert.notEqual(await fs.stat(`${LEGACY}/${a}.inkb`), null, "and the old folder is still left alone");
});

test("two notes with one weaveforge-id (a copied file) get no strokes until one changes, so neither can write into the other", async () => {
  const a = typedCore().newInkChunkId();
  const copy = "thesis--2a3407/notes/losses copy.ink.md";
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID, [a]), [`${STROKES}/${a}.inkb`]: bytes(5), [copy]: noteText(ID, [a]) });
  const { store, reports } = stores(fs);
  await assert.rejects(store.write(ID, typedCore().newInkChunkId(), bytes(1)), /no file in the workspace folder/);
  assert.deepEqual(Object.keys(await filesUnder(fs, STROKES)), [`${STROKES}/${a}.inkb`], "the original's pages are untouched");
  const clash = reports.find((r) => r.level === "error" && r.message.includes(ID));
  assert.ok(clash && clash.message.includes(NOTE_PATH) && clash.message.includes(copy), "the error names both files");
});

test("a user folder that only ends in .ink is an ordinary folder: its notes are found and it is not reported", async () => {
  const note = "thesis--2a3407/research.ink/chapter.ink.md";
  const fs = await folderWith({ [note]: noteText(ID), "thesis--2a3407/research.ink/plan.md": "# plan\n" });
  const { store, reports } = stores(fs);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(4));
  assert.notEqual(await fs.stat(`thesis--2a3407/research.ink/chapter.ink/${page}.inkb`), null);
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
});

test("a copy that does not read back the same is undone, the old folder kept, and the failure logged", async () => {
  const a = typedCore().newInkChunkId();
  const fs = await folderWith({ [NOTE_PATH]: noteText(ID, [a]), [`${LEGACY}/${a}.inkb`]: bytes(1, 2, 3) });
  const realWrite = fs.writeFile.bind(fs);
  fs.writeFile = async (path, data) => {
    // A disk that flips a byte on the way down.
    if (path.startsWith(`${STROKES}/`) && data instanceof Uint8Array) return realWrite(path, bytes(9, 9, 9));
    return realWrite(path, data);
  };
  const { store, reports } = stores(fs);
  assert.equal(await store.read(ID, a), null);
  assert.equal(await fs.stat(STROKES), null, "no half-copied folder is left to win next time");
  assert.deepEqual([...(await fs.readFile(`${LEGACY}/${a}.inkb`))], [1, 2, 3]);
  assert.ok(reports.some((r) => r.level === "error" && r.message.includes(LEGACY)));
});

test("stroke folders with no note are reported and never deleted", async () => {
  const orphanId = "3b5e3b7c-8011-44a8-a085-adca69a5d28d";
  const page = typedCore().newInkChunkId();
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID),
    [`.ink/${orphanId}/${page}.inkb`]: bytes(1),
    [`thesis--2a3407/notes/gone.ink/${page}.inkb`]: bytes(2),
  });
  const { store, reports } = stores(fs);
  await store.list(ID);
  const strays = reports.filter((r) => r.level === "warn").map((r) => r.message).join("\n");
  assert.match(strays, new RegExp(`\\.ink/${orphanId}`));
  assert.match(strays, /thesis--2a3407\/notes\/gone\.ink/);
  assert.notEqual(await fs.stat(`.ink/${orphanId}/${page}.inkb`), null);
  assert.notEqual(await fs.stat(`thesis--2a3407/notes/gone.ink/${page}.inkb`), null);
});

/** A page with one real stroke, as the editor would save it. */
function pageWithStroke(x: number): InkPage {
  return {
    ...typedCore().blankInkPage("ruled"),
    strokes: [
      typedCore().makeInkStroke({
        points: [x, 100, x + 40, 160, x + 80, 120],
        pressures: [10, 20, 30],
        width: 5,
        tool: "pen",
        colour: "accent",
        lineIndex: 0,
      }),
    ],
  };
}

test("a vault shaped like the real one (3 pages, ULID order, quoted id, old .ink/ at the root) migrates and opens with every stroke", async () => {
  const codec = inkChunkCodec("deflate-raw") ?? undefined;
  const order = ["01M7QJ04XZE9BD50WYX05CZ5H6", "01M7RQA78M9DDNS24XGHSNXRJD", "01M7RQA8076JV6ZPTNQZHWFMB3"];
  const files: Record<string, string | Uint8Array> = {
    [NOTE_PATH]: `${noteText(ID, order)}\n<!-- page 2 -->\n\n<!-- page 3 -->\n`,
    [`${LEGACY}/migrated`]: "legacy bucket ink copied into this folder\n",
    ".ink/3b5e3b7c-8011-44a8-a085-adca69a5d28d/01M7QJ04XZE9BD50WYX05CZ5H7.inkb": bytes(0),
  };
  for (const [index, chunk] of order.entries()) {
    files[`${LEGACY}/${chunk}.inkb`] = await encodeInkChunk(pageWithStroke(100 * (index + 1)), codec);
  }
  const fs = await folderWith(files);
  const { store } = stores(fs);
  const meta = typedCore().readInkNoteMeta(typedCore().readFrontmatter(await fs.readText(NOTE_PATH)).frontmatter);
  const pages = await loadInkPages(store, ID, meta);
  assert.deepEqual(pages.map((page) => page.chunkId), order);
  for (const [index, page] of pages.entries()) {
    assert.ok(page.chunk && !page.unreadable, `page ${index + 1} has its strokes`);
    const model = pageFromChunk(await decodeInkChunk(page.chunk, codec));
    assert.equal(model.strokes.length, 1);
    assert.equal(model.strokes[0]!.points[0], 100 * (index + 1));
  }
  assert.equal(await store.isMigrated(ID), true);
  for (const chunk of order) assert.notEqual(await fs.stat(`${STROKES}/${chunk}.inkb`), null);
  assert.notEqual(await fs.stat(`${LEGACY}/${order[0]}.inkb`), null, "the old folder stays");
});

/** A plain note as FileNoteRepository writes it: no `.ink.md`, no ink header. */
function plainNoteText(id: string): string {
  return ["---", `weaveforge-id: "${id}"`, "weaveforge-type: vault_page", "---", "", "# Losses", ""].join("\n");
}

test("every note takes ink: a .note.md keeps its pages in a .note.ink folder beside it", async () => {
  const note = "thesis--2a3407/notes/losses.note.md";
  const fs = await folderWith({ [note]: plainNoteText(ID) });
  const { store, reports } = stores(fs);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(7));
  const dir = "thesis--2a3407/notes/losses.note.ink";
  assert.deepEqual(Object.keys(await filesUnder(fs, dir)), [`${dir}/${page}.inkb`]);
  assert.deepEqual([...(await store.read(ID, page))!], [7]);
  assert.deepEqual(await store.list(ID), [page]);
  assert.deepEqual(reports.filter((r) => r.level !== "info"), [], "its own folder is not a stray");
});

test("every note takes ink: a plain foo.md keeps its pages in foo.ink beside it", async () => {
  const note = "thesis--2a3407/notes/losses.md";
  const fs = await folderWith({ [note]: plainNoteText(ID) });
  const { store, reports } = stores(fs);
  const page = typedCore().newInkChunkId();
  await store.write(ID, page, bytes(8));
  assert.notEqual(await fs.stat(`${STROKES}/${page}.inkb`), null);
  // A second scan (a fresh store) still pairs the folder with the plain note and reports nothing.
  const again = stores(fs);
  assert.deepEqual([...(await again.store.read(ID, page))!], [8]);
  assert.deepEqual([...reports, ...again.reports].filter((r) => r.level !== "info"), []);
});

test("a legacy .ink.md with strokes, moved on disk with its folder to a .note.md name, keeps every stroke", async () => {
  const a = typedCore().newInkChunkId();
  const b = typedCore().newInkChunkId();
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID, [a, b]),
    [`${STROKES}/${a}.inkb`]: bytes(1),
    [`${STROKES}/${b}.inkb`]: bytes(2),
  });
  const { store, reports } = stores(fs);
  assert.deepEqual(await store.list(ID), [a, b].sort());
  const renamed = "thesis--2a3407/archive/loss-review.note.md";
  const renamedDir = "thesis--2a3407/archive/loss-review.note.ink";
  await fs.mkdirp(renamedDir);
  await fs.writeFile(renamed, await fs.readText(NOTE_PATH));
  for (const chunk of [a, b]) await fs.writeFile(`${renamedDir}/${chunk}.inkb`, await fs.readFile(`${STROKES}/${chunk}.inkb`));
  await fs.remove(NOTE_PATH);
  for (const chunk of [a, b]) await fs.remove(`${STROKES}/${chunk}.inkb`);
  await fs.remove(STROKES);
  assert.deepEqual([...(await store.read(ID, a))!], [1]);
  assert.deepEqual([...(await store.read(ID, b))!], [2]);
  assert.deepEqual(await store.list(ID), [a, b].sort());
  assert.deepEqual(reports.filter((r) => r.level !== "info"), []);
});

test("a .note.ink folder whose note is gone is still reported as a stray and kept", async () => {
  const page = typedCore().newInkChunkId();
  const fs = await folderWith({
    [NOTE_PATH]: noteText(ID),
    [`thesis--2a3407/notes/gone.note.ink/${page}.inkb`]: bytes(2),
  });
  const { store, reports } = stores(fs);
  await store.list(ID);
  const strays = reports.filter((r) => r.level === "warn").map((r) => r.message).join("\n");
  assert.match(strays, /thesis--2a3407\/notes\/gone\.note\.ink/);
  assert.notEqual(await fs.stat(`thesis--2a3407/notes/gone.note.ink/${page}.inkb`), null);
});