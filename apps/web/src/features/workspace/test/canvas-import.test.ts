/**
 * A canvas in a folder import.
 *
 * A canvas is a raw `.canvas` file. The import creates it as a canvas page, not a
 * markdown note, and the claim never stamps frontmatter into it.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { IWorkspaceFs } from "@weaveforge/core";
import type { ImportDiff } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";
import { applyEntries } from "../application/parts-1";
import { canvasRenameIds, claimImportedFile, writeTextAtomic } from "../application/parts-3";

const BOARD = '{"nodes":[],"edges":[]}';

/** An in-memory folder with just the reads and writes the import makes. */
function memoryFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const fs = {
    readText: async (path: string) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    readFile: async (path: string) => new TextEncoder().encode(store.get(path) ?? ""),
    writeFile: async (path: string, data: Uint8Array | string) => {
      store.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    remove: async (path: string) => void store.delete(path),
    mkdirp: async () => undefined,
    list: async () => [],
    walk: async function* () {},
    stat: async () => null,
    rename: async (from: string, to: string) => {
      const text = store.get(from);
      if (text === undefined) throw new Error(`missing ${from}`);
      store.delete(from);
      store.set(to, text);
    },
  } as unknown as IWorkspaceFs;
  return { fs, store };
}

/** Records every page the apply adds, with the input it was given. */
function fakeContainer() {
  const added: Array<{ title: string; body: string; kind?: string }> = [];
  let next = 0;
  const container = {
    projects: {
      context: { projectId: "p1" },
      listProjects: async () => [{ id: "p1", name: "Thesis" }],
    },
    workspace: { snapshot: async () => ({ vaultPages: [], papers: [] }) },
    vault: {
      getPage: async () => null,
      manageVaultPage: {
        add: async (input: { title: string; body: string; kind?: string }) => {
          next += 1;
          added.push(input);
          return { id: `page-${next}`, ...input };
        },
        update: async () => undefined,
      },
    },
  } as unknown as AppContainer;
  return { container, added };
}

let projectRoot = "";
let metaDir = "";

before(async () => {
  const core = await loadTestCore();
  projectRoot = core.projectDir({ id: "p1", name: "Thesis" });
  metaDir = core.projectMetaDir(projectRoot);
});

after(() => setContainerForTests(null));

test("a canvas entry is created as a canvas page, not a markdown note", async () => {
  const { container, added } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/board.canvas`;
  const { fs } = memoryFs({ [path]: BOARD });
  const diff = {
    entries: [
      {
        action: "created",
        entity: { type: "vault_page", kind: "canvas", title: "Board", body: BOARD, path, fields: {} },
      },
    ],
    counts: { created: 1 },
  } as unknown as ImportDiff;

  const result = await applyEntries(fs, diff, {});

  assert.equal(result.created, 1);
  assert.deepEqual(added.map((input) => input.kind), ["canvas"]);
  assert.equal(added[0]?.body, BOARD, "the raw body is the page body");
});

/** The id map the claim writes, keyed by project-relative path. */
function idMap(store: Map<string, string>): Record<string, string> {
  const text = store.get(`${metaDir}/canvas-ids.json`);
  return text === undefined ? {} : JSON.parse(text);
}

test("claiming a canvas file records its id in the map and never edits the file", async () => {
  const path = `${projectRoot}/notes/board.canvas`;
  const { fs, store } = memoryFs({ [path]: BOARD });

  const claimed = await claimImportedFile(fs, path, "page-1", projectRoot);

  assert.equal(claimed, true);
  assert.equal(store.get(path), BOARD, "the raw JSON is untouched");
  assert.deepEqual(idMap(store), { "notes/board.canvas": "page-1" });
  const manifest = store.get(`${metaDir}/mirror.json`) ?? "";
  assert.ok(manifest.includes("notes/board.canvas"), "the path is in the manifest");
});

test("claiming Board.canvas and a non-slug name keys the map by the exact path", async () => {
  const board = `${projectRoot}/Board.canvas`;
  const spaced = `${projectRoot}/My Plan (v2).canvas`;
  const { fs, store } = memoryFs({ [board]: BOARD, [spaced]: BOARD });

  assert.equal(await claimImportedFile(fs, board, "page-1", projectRoot), true);
  assert.equal(await claimImportedFile(fs, spaced, "page-2", projectRoot), true);

  assert.deepEqual(idMap(store), { "Board.canvas": "page-1", "My Plan (v2).canvas": "page-2" });
});

test("claiming a canvas in a subfolder keys it by its nested path", async () => {
  const path = `${projectRoot}/a/b/deep.canvas`;
  const { fs, store } = memoryFs({ [path]: BOARD });

  assert.equal(await claimImportedFile(fs, path, "page-3", projectRoot), true);

  assert.deepEqual(idMap(store), { "a/b/deep.canvas": "page-3" });
});

test("claiming the same canvas twice keeps one map entry", async () => {
  const path = `${projectRoot}/notes/board.canvas`;
  const { fs, store } = memoryFs({ [path]: BOARD });

  await claimImportedFile(fs, path, "page-1", projectRoot);
  await claimImportedFile(fs, path, "page-1", projectRoot);

  assert.deepEqual(idMap(store), { "notes/board.canvas": "page-1" });
});

test("a broken id map is held: the claim writes nothing and keeps the bad file", async () => {
  const path = `${projectRoot}/notes/board.canvas`;
  const mapPath = `${metaDir}/canvas-ids.json`;
  const { fs, store } = memoryFs({ [path]: BOARD, [mapPath]: "{not json" });

  assert.equal(await claimImportedFile(fs, path, "page-1", projectRoot), false);
  assert.equal(store.get(mapPath), "{not json", "the broken map is not overwritten");
});

test("a failed map write leaves the previous canvas id map whole", async () => {
  const mapPath = `${metaDir}/canvas-ids.json`;
  const old = '{"a.canvas":"page-1"}';
  const { fs, store } = memoryFs({ [mapPath]: old });
  const failing = {
    ...fs,
    writeFile: async () => {
      throw new Error("disk full");
    },
  } as unknown as IWorkspaceFs;

  await assert.rejects(writeTextAtomic(failing, mapPath, '{"a.canvas":"page-1","b.canvas":"page-2"}'));
  assert.equal(store.get(mapPath), old, "the old map is still the one on disk");
});

test("an atomic map write replaces the map and leaves no temp file behind", async () => {
  const mapPath = `${metaDir}/canvas-ids.json`;
  const { fs, store } = memoryFs({ [mapPath]: "{}" });

  await writeTextAtomic(fs, mapPath, '{"a.canvas":"page-1"}');

  assert.equal(store.get(mapPath), '{"a.canvas":"page-1"}');
  assert.deepEqual([...store.keys()].filter((key) => key.endsWith(".tmp")), []);
});

/** A parsed folder entity for a canvas file that has no id yet. */
function unmappedCanvas(path: string, body: string) {
  return { path, kind: "canvas", body };
}

test("a canvas renamed outside the app is matched to its page by body", () => {
  const renamed = `${projectRoot}/Renamed.canvas`;
  const ids = canvasRenameIds(
    { [renamed]: BOARD },
    projectRoot,
    [{ id: "page-1", kind: "canvas", body: BOARD }],
    [unmappedCanvas(renamed, BOARD)],
    { "notes/board.canvas": "page-1" },
  );

  assert.equal(ids.get(renamed), "page-1");
});

test("two lost pages with the same body are ambiguous and match nothing", () => {
  const renamed = `${projectRoot}/Moved.canvas`;
  const ids = canvasRenameIds(
    { [renamed]: BOARD },
    projectRoot,
    [
      { id: "page-1", kind: "canvas", body: BOARD },
      { id: "page-2", kind: "canvas", body: BOARD },
    ],
    [unmappedCanvas(renamed, BOARD)],
    { "a.canvas": "page-1", "b.canvas": "page-2" },
  );

  assert.equal(ids.size, 0, "which page the file came from is unknown, so it is not assigned");
});

test("two new files with the same body do not both take the one lost page", () => {
  const one = `${projectRoot}/one.canvas`;
  const two = `${projectRoot}/two.canvas`;
  const ids = canvasRenameIds(
    { [one]: BOARD, [two]: BOARD },
    projectRoot,
    [{ id: "page-1", kind: "canvas", body: BOARD }],
    [unmappedCanvas(one, BOARD), unmappedCanvas(two, BOARD)],
    { "old.canvas": "page-1" },
  );

  assert.equal(ids.size, 0, "two candidates for one page is ambiguous, so neither is assigned");
});

test("a renamed canvas whose body was also edited is not matched, so nothing is lost", () => {
  const renamed = `${projectRoot}/Renamed.canvas`;
  const edited = '{"nodes":[{"id":"n1"}],"edges":[]}';
  const ids = canvasRenameIds(
    { [renamed]: edited },
    projectRoot,
    [{ id: "page-1", kind: "canvas", body: BOARD }],
    [unmappedCanvas(renamed, edited)],
    { "notes/board.canvas": "page-1" },
  );

  assert.equal(ids.size, 0, "no match, so the file is imported as a new page and page-1 is kept");
});

test("a canvas renamed into a subfolder is matched to its page", () => {
  const moved = `${projectRoot}/a/b/moved.canvas`;
  const ids = canvasRenameIds(
    { [moved]: BOARD },
    projectRoot,
    [{ id: "page-1", kind: "canvas", body: BOARD }],
    [unmappedCanvas(moved, BOARD)],
    { "notes/board.canvas": "page-1" },
  );

  assert.equal(ids.get(moved), "page-1");
});
