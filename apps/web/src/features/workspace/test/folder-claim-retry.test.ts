/**
 * A hand-written file whose id could not be written back, imported twice.
 *
 * The file keeps no id, so the second preview offers it as new again. The
 * second apply has to update the note the first one made, not add another.
 * Also covers `refreshMirrorBase`, which needs the same stand-in container.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { IWorkspaceFs, ImportDiff, ImportDiffEntry } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { applyEntries } from "../application/folder-import-apply";
import { refreshMirrorBase } from "../application/folder-json-import";
import { baseDigest, readMirrorBase } from "../application/mirror-manifest";

/** An in-memory folder; `failWrites` paths throw on write until removed. */
function memoryFs(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const failWrites = new Set<string>();
  const fs = {
    readText: async (path: string) => {
      const text = store.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    readFile: async (path: string) => new TextEncoder().encode(await fs.readText(path)),
    writeFile: async (path: string, data: Uint8Array | string) => {
      if (failWrites.has(path)) throw new Error(`cannot write ${path}`);
      store.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    remove: async (path: string) => void store.delete(path),
    mkdirp: async () => undefined,
    list: async () => [],
    walk: async function* () {},
    stat: async () => null,
    rename: async () => undefined,
  } as unknown as IWorkspaceFs;
  return { fs, store, failWrites };
}

/** Just the container members the apply and the base refresh touch. */
function fakeContainer() {
  const pages = new Map<string, { id: string; title: string; body: string }>();
  let next = 0;
  const container = {
    projects: {
      context: { projectId: "p1" },
      listProjects: async () => [{ id: "p1", name: "Thesis" }],
    },
    workspace: { snapshot: async () => ({ vaultPages: [], papers: [] }) },
    vault: {
      getPage: async (id: string) => pages.get(id) ?? null,
      manageVaultPage: {
        add: async (input: { title: string; body: string }) => {
          next += 1;
          const page = { id: `page-${next}`, ...input };
          pages.set(page.id, page);
          return page;
        },
        update: async (id: string, input: { title: string; body: string }) => {
          pages.set(id, { id, ...input });
        },
      },
    },
  } as unknown as AppContainer;
  return { container, pages };
}

function created(path: string, body: string): ImportDiff {
  const entry: ImportDiffEntry = {
    action: "created",
    entity: { type: "vault_page", title: "Idea", body, path, fields: {} },
  };
  return { entries: [entry], counts: { created: 1 } } as ImportDiff;
}

let projectRoot = "";

before(async () => {
  const core = await loadTestCore();
  projectRoot = core.projectDir({ id: "p1", name: "Thesis" });
});

after(() => setContainerForTests(null));

test("a file whose id could not be written updates its note on the next apply", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/idea.md`;
  const { fs, store, failWrites } = memoryFs({ [path]: "# Idea\n\nfirst\n" });

  failWrites.add(path);
  const first = await applyEntries(fs, created(path, "first"), {});
  assert.deepEqual([first.created, first.updated], [1, 0]);

  failWrites.delete(path);
  const second = await applyEntries(fs, created(path, "second"), {});
  assert.deepEqual([second.created, second.updated], [0, 1]);
  assert.equal(pages.size, 1);
  assert.equal(pages.get("page-1")?.body, "second");
  assert.match(store.get(path) ?? "", /page-1/);
});

test("a file claimed the first time is created once, then left alone", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/other.md`;
  const { fs, store } = memoryFs({ [path]: "# Other\n\nbody\n" });

  const first = await applyEntries(fs, created(path, "body"), {});
  assert.deepEqual([first.created, first.updated], [1, 0]);
  assert.equal(pages.size, 1);
  assert.match(store.get(path) ?? "", /page-1/);
});

test("refreshMirrorBase records the folder's text, but not a file that moved since", async () => {
  const { container } = fakeContainer();
  setContainerForTests(container);
  const kept = `${projectRoot}/notes/kept.md`;
  const moved = `${projectRoot}/notes/moved.md`;
  const { fs } = memoryFs({ [kept]: "kept\n", [moved]: "moved now\n" });

  await refreshMirrorBase(fs, [kept, moved], { [moved]: baseDigest("moved then\n") });
  const base = await readMirrorBase(fs, projectRoot);
  assert.equal(base[kept], baseDigest("kept\n"));
  assert.equal(base[moved], undefined);
});
