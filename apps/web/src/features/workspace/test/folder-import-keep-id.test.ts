/**
 * Bringing back a file that already declares a `weaveforge-id` the workspace
 * does not know (an ink note from another machine, say).
 *
 * The note must keep the file's id and created-at, so its strokes in
 * `.ink/<id>/` are found; the import must not touch the file or write ink
 * under any other id; and an id another row holds is refused, never re-IDed.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { IWorkspaceFs } from "@weaveforge/core";
import type { ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import { loadTestCore } from "@/lib/test/load-test-core";
import { applyEntries } from "../application/parts-1";
import { CopyOnReadInkChunkStore, FsInkChunkStore } from "@/features/ink/infrastructure/parts";

const FILE_ID = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const FILE_CREATED = "2026-11-18T14:45:32.123Z";
const CHUNK = "01M7QJ04XZE9BD50WYX05CZ5H6";
const STROKES = new Uint8Array([1, 2, 3, 4]);

/** An in-memory folder holding text and bytes; a directory exists when a file sits under it. */
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
    list: async (dir: string) =>
      [...store.keys()]
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"))
        .map((path) => ({ path, kind: "file" as const })),
    walk: async function* () {},
    stat: async (path: string) =>
      store.has(path) || [...store.keys()].some((p) => p.startsWith(`${path}/`)) ? { kind: "file" } : null,
    rename: async () => undefined,
  } as unknown as IWorkspaceFs;
  return { fs, store };
}

type Added = { title: string; body: string; id?: string; createdAt?: string };

/** The container members the apply touches; `add` honours a given id, as the repo does. */
function fakeContainer(taken: string[] = []) {
  const pages = new Map<string, Added & { id: string }>();
  for (const id of taken) pages.set(id, { id, title: "Someone else", body: "theirs" });
  const added: Added[] = [];
  const container = {
    projects: {
      context: { projectId: "p1" },
      listProjects: async () => [{ id: "p1", name: "Thesis" }],
    },
    workspace: { snapshot: async () => ({ vaultPages: [], papers: [] }) },
    vault: {
      getPage: async (id: string) => pages.get(id) ?? null,
      manageVaultPage: {
        add: async (input: Added) => {
          added.push(input);
          const id = input.id ?? `minted-${added.length}`;
          if (pages.has(id)) throw Object.assign(new Error(`id ${id} taken`), { name: "VaultPageIdTakenError" });
          const page = { ...input, id };
          pages.set(id, page);
          return page;
        },
        update: async () => undefined,
      },
    },
  } as unknown as AppContainer;
  return { container, pages, added };
}

let projectRoot = "";
let inkPath = "";
let inkFile = "";

before(async () => {
  const core = await loadTestCore();
  projectRoot = core.projectDir({ id: "p1", name: "Thesis" });
  inkPath = `${projectRoot}/notes/losses.ink.md`;
  inkFile = `---\nweaveforge-id: ${FILE_ID}\nweaveforge-type: vault_page\ntitle: Losses\ncreated-at: "${FILE_CREATED}"\n---\n\nink\n`;
});

after(() => setContainerForTests(null));

/** What the preview hands the apply for that file: new to the workspace, with its own id. */
function createdWithId(): ImportDiff {
  const entry: ImportDiffEntry = {
    action: "created",
    entity: {
      id: FILE_ID,
      type: "vault_page",
      title: "Losses",
      body: "ink",
      path: inkPath,
      fields: { "created-at": FILE_CREATED },
    },
  };
  return { entries: [entry], counts: { created: 1 } } as ImportDiff;
}

function inkFolder() {
  return memoryFs({
    [inkPath]: inkFile,
    [`.ink/${FILE_ID}/${CHUNK}.inkb`]: STROKES,
    [`.ink/${FILE_ID}/migrated`]: "legacy bucket ink copied into this folder\n",
  });
}

test("a file with an id the workspace does not know keeps that id and its created-at", async () => {
  const { container, pages, added } = fakeContainer();
  setContainerForTests(container);
  const { fs } = inkFolder();

  const result = await applyEntries(fs, createdWithId(), {});
  assert.equal(result.created, 1);
  assert.equal(added[0]?.id, FILE_ID);
  assert.equal(added[0]?.createdAt, FILE_CREATED);
  assert.deepEqual([...pages.keys()], [FILE_ID]);
});

test("the import leaves the file's bytes alone", async () => {
  const { container } = fakeContainer();
  setContainerForTests(container);
  const { fs, store } = inkFolder();
  const before = new Map(store);

  await applyEntries(fs, createdWithId(), {});
  assert.deepEqual(store, before);
});

test("the note's strokes are found under its id and no ink is written under another", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const { fs, store } = inkFolder();
  await applyEntries(fs, createdWithId(), {});
  const [noteId] = [...pages.keys()];
  assert.ok(noteId);

  const bucket = {
    read: async () => {
      throw new Error("the bucket must not be asked");
    },
  } as never;
  const ink = new CopyOnReadInkChunkStore(new FsInkChunkStore(() => fs), bucket);
  await ink.prepareNote(noteId, [CHUNK]);
  assert.deepEqual(await ink.read(noteId, CHUNK), STROKES);
  const inkPaths = [...store.keys()].filter((p) => p.startsWith(".ink/"));
  assert.deepEqual(inkPaths.filter((p) => !p.startsWith(`.ink/${FILE_ID}/`)), []);
});

test("an id another note holds is refused, not given a new id, and the rest of the batch goes on", async () => {
  const { container, pages, added } = fakeContainer([FILE_ID]);
  setContainerForTests(container);
  const { fs, store } = inkFolder();
  const before = new Map(store);
  const other: ImportDiffEntry = {
    action: "created",
    entity: { type: "vault_page", title: "Other", body: "other", path: `${projectRoot}/notes/other.md`, fields: {} },
  };
  const batch = { entries: [...createdWithId().entries, other], counts: { created: 2 } } as ImportDiff;

  const result = await applyEntries(fs, batch, {});
  assert.deepEqual(result.refused, [inkPath]);
  assert.equal(result.created, 1);
  assert.equal(added.length, 2);
  assert.equal(added[0]?.id, FILE_ID);
  assert.equal(added[1]?.id, undefined);
  assert.equal(pages.get(FILE_ID)?.body, "theirs");
  assert.ok(![...pages.values()].some((page) => page.body === "ink"));
  assert.deepEqual(store, before);
});
