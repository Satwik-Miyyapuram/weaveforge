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
import { claimImportedFile } from "../application/parts-3";

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
    rename: async () => undefined,
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

before(async () => {
  const core = await loadTestCore();
  projectRoot = core.projectDir({ id: "p1", name: "Thesis" });
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

test("claiming a canvas file writes nothing into it", async () => {
  const path = `${projectRoot}/notes/board.canvas`;
  const { fs, store } = memoryFs({ [path]: BOARD });

  const claimed = await claimImportedFile(fs, path, "page-1", projectRoot);

  assert.equal(claimed, false, "a canvas is never stamped");
  assert.equal(store.get(path), BOARD, "the raw JSON is untouched");
  assert.deepEqual([...store.keys()], [path], "no manifest is written for it");
});
