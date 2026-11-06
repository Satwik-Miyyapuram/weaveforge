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
import { applyEntries, keepWorkspaceCopy, storedDigest, titleFromFileName } from "../application/folder-import-apply";
import { renameSources } from "../application/folder-diff";
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

function updated(id: string, path: string, body: string): ImportDiff {
  const entry: ImportDiffEntry = {
    action: "updated",
    entity: { id, type: "vault_page", title: "Idea", body, path, fields: {} },
  };
  return { entries: [entry], counts: { updated: 1 } } as ImportDiff;
}

test("an update is skipped and reported moved when the note changed since the preview", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/idea.md`;
  const { fs } = memoryFs({ [path]: "# Idea\n\nfolder\n" });
  pages.set("p-1", { id: "p-1", title: "Idea", body: "typed in app" });

  const stale = { "p-1": storedDigest({ title: "Idea", body: "before" }) };
  const result = await applyEntries(fs, updated("p-1", path, "folder"), {}, stale);
  assert.deepEqual(result.moved, [path]);
  assert.equal(result.updated, 0);
  assert.equal(pages.get("p-1")?.body, "typed in app");
});

test("an update goes ahead when the note is as the preview saw it", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/idea.md`;
  const { fs } = memoryFs({ [path]: "# Idea\n\nfolder\n" });
  pages.set("p-1", { id: "p-1", title: "Idea", body: "before" });

  const fresh = { "p-1": storedDigest({ title: "Idea", body: "before" }) };
  const result = await applyEntries(fs, updated("p-1", path, "folder"), {}, fresh);
  assert.deepEqual(result.moved, []);
  assert.equal(result.updated, 1);
  assert.equal(pages.get("p-1")?.body, "folder");
});

test("a renamed note takes its title from the new name and leaves the file to the mirror", async () => {
  const { container, pages } = fakeContainer();
  setContainerForTests(container);
  const path = `${projectRoot}/notes/big idea.note.md`;
  const { fs, store } = memoryFs({ [path]: "# Idea\n\nbody\n" });
  pages.set("p-1", { id: "p-1", title: "Idea", body: "body" });

  const result = await applyEntries(fs, updated("p-1", path, "body"), {}, undefined, new Set([path]));
  assert.equal(result.updated, 1);
  assert.deepEqual(result.appliedPaths, []);
  assert.equal(pages.get("p-1")?.title, "big idea");
  assert.equal(store.has(path), false);
});

test("titleFromFileName drops the folder, kind suffix and id suffix", () => {
  assert.equal(titleFromFileName("p/notes/Big Idea.note.md"), "Big Idea");
  assert.equal(titleFromFileName("sketch--ab12cd.ink.md"), "sketch");
  assert.equal(titleFromFileName("plain.md"), "plain");
  assert.equal(titleFromFileName("notes/.note.md"), "Untitled");
});

test("renameSources: the only file with an id whose old file is gone is a rename; with the old file, a copy", () => {
  const stamp = (id: string) => `---\nweaveforge-id: ${id}\n---\n\nbody\n`;
  const current = { "n/a.note.md": stamp("a"), "n/b.note.md": stamp("b") };
  const folder = { "n/a2.note.md": stamp("a"), "n/b.note.md": stamp("b"), "n/b copy.note.md": stamp("b") };
  const parsed = [
    { id: "a", path: "n/a2.note.md" },
    { id: "b", path: "n/b.note.md" },
    { id: "b", path: "n/b copy.note.md" },
    { id: null, path: "n/new.note.md" },
  ];
  assert.deepEqual(renameSources(parsed, folder, current), { "n/a2.note.md": "n/a.note.md" });
});

test("keeping the workspace copy writes it over the folder's file and makes it the base", async () => {
  const { container } = fakeContainer();
  const page = { id: "p-1", title: "Idea", body: "mine", parentId: null };
  (container as unknown as { workspace: unknown }).workspace = {
    snapshot: async () => ({ vaultPages: [page], papers: [] }),
  };
  setContainerForTests(container);
  const core = await loadTestCore();
  const files = core.serializeWorkspace({ vaultPages: [page], papers: [] } as never, { id: "p1", name: "Thesis" }).files;
  const path = Object.keys(files).find((key) => key.endsWith(".md") && files[key]?.includes("p-1"));
  assert.ok(path);
  const { fs, store } = memoryFs({ [path]: "theirs\n" });

  assert.equal(await keepWorkspaceCopy(fs, path), true);
  assert.equal(store.get(path), files[path]);
  assert.equal((await readMirrorBase(fs, projectRoot))[path], baseDigest(files[path] ?? ""));
  assert.equal(await keepWorkspaceCopy(fs, `${projectRoot}/notes/none.md`), false);
});
