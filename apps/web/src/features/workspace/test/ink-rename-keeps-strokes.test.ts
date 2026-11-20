/**
 * Renaming an ink note keeps its strokes: the `.inkb` pages sit beside the note in
 * `notes/<name>.ink/` (ink-by-name), so when the note moves to a new name the stroke
 * folder must follow it, found by the note's id after the move.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { IWorkspaceFs } from "@weaveforge/core";
import type { ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";
import { applyEntries } from "../application/parts-1";
import { CopyOnReadInkChunkStore, FolderInkNotes, FsInkChunkStore } from "@/features/ink/infrastructure/parts";

const NOTE_ID = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const CHUNK = "01M7QJ04XZE9BD50WYX05CZ5H6";
const STROKES = new Uint8Array([9, 8, 7]);

/** An in-memory folder; a directory exists when a file sits under it. */
function memoryFs(files: Record<string, string | Uint8Array>) {
  const store = new Map<string, string | Uint8Array>(Object.entries(files));
  const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  const fs = {
    readText: async (path: string) => {
      const v = store.get(path);
      if (v === undefined) throw new Error(`missing ${path}`);
      return typeof v === "string" ? v : new TextDecoder().decode(v);
    },
    readFile: async (path: string) => {
      const v = store.get(path);
      if (v === undefined) throw new Error(`missing ${path}`);
      return bytes(v);
    },
    writeFile: async (path: string, data: Uint8Array | string) => void store.set(path, data),
    remove: async (path: string) => void store.delete(path),
    mkdirp: async () => undefined,
    list: async (dir: string) => {
      const prefix = dir === "" ? "" : `${dir}/`;
      const children = new Map<string, "file" | "dir">();
      for (const p of store.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) children.set(p, "file");
        else children.set(prefix + rest.slice(0, slash), "dir");
      }
      return [...children].map(([path, kind]) => ({ path, kind }));
    },
    walk: async function* () {},
    stat: async (path: string) =>
      store.has(path) || [...store.keys()].some((p) => p.startsWith(`${path}/`)) ? { kind: "file" } : null,
    rename: async () => undefined,
  } as unknown as IWorkspaceFs;
  return { fs, store };
}

let projectRoot = "";
let oldPath = "";
let newPath = "";

before(async () => {
  const core = await loadTestCore();
  projectRoot = core.projectDir({ id: "p1", name: "Thesis" });
  oldPath = `${projectRoot}/notes/losses.ink.md`;
  newPath = `${projectRoot}/notes/loss-review.ink.md`;
});

after(() => setContainerForTests(null));

function fakeContainer() {
  const pages = new Map<string, { id: string; title: string; body: string }>();
  pages.set(NOTE_ID, { id: NOTE_ID, title: "Losses", body: "ink" });
  const container = {
    projects: {
      context: { projectId: "p1" },
      listProjects: async () => [{ id: "p1", name: "Thesis" }],
    },
    workspace: { snapshot: async () => ({ vaultPages: [], papers: [] }) },
    vault: {
      getPage: async (id: string) => pages.get(id) ?? null,
      manageVaultPage: {
        add: async () => {
          throw new Error("no add in a rename");
        },
        update: async (id: string, input: { title: string; body: string }) => {
          const page = pages.get(id);
          if (page) pages.set(id, { ...page, ...input });
        },
      },
    },
  } as unknown as AppContainer;
  setContainerForTests(container);
  return pages;
}

/** Renames `from` to `to` on disk as an outside edit does, applies the import, then reads the stroke back. */
async function renameAndRead(from: string, to: string, fromDir: string, toDir: string) {
  fakeContainer();
  const { fs, store } = memoryFs({
    [from]: `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: vault_page\ntitle: Losses\n---\n\nink\n`,
    [`${fromDir}/${CHUNK}.inkb`]: STROKES,
  });
  // The file moved on disk: the same note id now sits at the new name.
  store.delete(from);
  store.set(to, `---\nweaveforge-id: ${NOTE_ID}\nweaveforge-type: vault_page\ntitle: Loss review\n---\n\nink\n`);

  const entry: ImportDiffEntry = {
    action: "updated",
    entity: { id: NOTE_ID, type: "vault_page", title: "Loss review", body: "ink", path: to, fields: {} },
  } as ImportDiffEntry;
  const diff = { entries: [entry], counts: { updated: 1 } } as unknown as ImportDiff;
  await applyEntries(fs, diff, {}, undefined, new Set([to]), new Map([[to, from]]));

  const bucket = {
    read: async () => {
      throw new Error("the bucket must not be asked");
    },
  } as never;
  const ink = new CopyOnReadInkChunkStore(new FsInkChunkStore(() => fs, new FolderInkNotes(() => fs)), bucket);
  assert.deepEqual(await ink.read(NOTE_ID, CHUNK), STROKES);
  assert.ok(store.has(`${toDir}/${CHUNK}.inkb`));
  if (fromDir !== toDir) assert.ok(!store.has(`${fromDir}/${CHUNK}.inkb`), "the strokes moved, not copied");
}

test("renaming an ink note moves its stroke folder so the strokes are still found", async () => {
  await renameAndRead(oldPath, newPath, `${projectRoot}/notes/losses.ink`, `${projectRoot}/notes/loss-review.ink`);
});

test("renaming a plain .note.md moves its .note.ink stroke folder with it", async () => {
  await renameAndRead(
    `${projectRoot}/notes/losses.note.md`,
    `${projectRoot}/notes/loss-review.note.md`,
    `${projectRoot}/notes/losses.note.ink`,
    `${projectRoot}/notes/loss-review.note.ink`,
  );
});

test("a legacy .ink.md with strokes renamed to a .note.md keeps its strokes, moved to the new name", async () => {
  await renameAndRead(
    oldPath,
    `${projectRoot}/notes/loss-review.note.md`,
    `${projectRoot}/notes/losses.ink`,
    `${projectRoot}/notes/loss-review.note.ink`,
  );
});
test("two note names that share one strokes folder (foo.md and foo.ink.md) keep the strokes in place", async () => {
  const dir = `${projectRoot}/notes/losses.ink`;
  await renameAndRead(`${projectRoot}/notes/losses.md`, oldPath, dir, dir);
});