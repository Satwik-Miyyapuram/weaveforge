/**
 * A file the import refuses (its id is not valid, or another note holds it) is
 * named with the reason, and the next preview lists it as refused rather than
 * offering it as a new note again. No id is written into the file.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import type { AppContainer } from "@/bootstrap";
import { setContainerForTests } from "@/bootstrap";
import type { IWorkspaceFs } from "@weaveforge/core";
import type { ImportDiff, ImportDiffEntry } from "@weaveforge/wasm";
import { applyEntries, setAsideRefused } from "../application/parts-1";

const TAKEN = "4e64e8a9-cb73-418a-9909-00c3507060c3";
const BAD = "not-an-id";

/** A folder that records writes; the refused file must never be written. */
function memoryFs() {
  const writes: string[] = [];
  const fs = {
    readText: async () => {
      throw new Error("missing");
    },
    writeFile: async (path: string) => void writes.push(path),
    remove: async () => undefined,
    mkdirp: async () => undefined,
    stat: async () => null,
  } as unknown as IWorkspaceFs;
  return { fs, writes };
}

/** The repo's refusals: a malformed id fails validation, a held one is taken. */
function fakeContainer(holder?: { id: string; title: string }) {
  const pages = new Map<string, { id: string; title: string }>();
  if (holder) pages.set(holder.id, holder);
  let minted = 0;
  const container = {
    projects: { context: { projectId: "p1" }, listProjects: async () => [{ id: "p1", name: "Thesis" }] },
    workspace: { snapshot: async () => ({ vaultPages: [], papers: [] }) },
    vault: {
      getPage: async (id: string) => pages.get(id) ?? null,
      manageVaultPage: {
        add: async (input: { title: string; id?: string }) => {
          if (input.id === BAD) {
            throw Object.assign(new Error(`The file's weaveforge-id "${BAD}" is not a valid id.`), {
              name: "VaultPageValidationError",
            });
          }
          if (input.id && pages.has(input.id)) {
            throw Object.assign(new Error("Another note already has the id"), { name: "VaultPageIdTakenError" });
          }
          const page = { id: input.id ?? `minted-${++minted}`, title: input.title };
          pages.set(page.id, page);
          return page;
        },
        update: async () => undefined,
      },
    },
  } as unknown as AppContainer;
  return container;
}

after(() => setContainerForTests(null));

function created(path: string, id?: string): ImportDiffEntry {
  return {
    action: "created",
    entity: { ...(id ? { id } : {}), type: "vault_page", title: path, body: "b", path, fields: {} },
  } as ImportDiffEntry;
}

function batch(...entries: ImportDiffEntry[]): ImportDiff {
  return { entries, counts: { created: entries.length, updated: 0, removed: 0, unchanged: 0, conflict: 0 } } as ImportDiff;
}

test("an id that is not valid is refused with that reason and the rest of the batch goes in", async () => {
  setContainerForTests(fakeContainer());
  const { fs } = memoryFs();
  const result = await applyEntries(fs, batch(created("bad.md", BAD), created("plain.md")), {});
  assert.deepEqual(result.refused, [{ path: "bad.md", reason: "id not valid" }]);
  assert.equal(result.created, 1);
});

test("an id another note holds is refused naming that note", async () => {
  setContainerForTests(fakeContainer({ id: TAKEN, title: "Losses" }));
  const { fs, writes } = memoryFs();
  const result = await applyEntries(fs, batch(created("copy.md", TAKEN)), {});
  assert.deepEqual(result.refused, [{ path: "copy.md", reason: "id already used by Losses" }]);
  assert.equal(result.created, 0);
  assert.ok(!writes.includes("copy.md"), "no id is written into the refused file");
});

test("a holder this project cannot read is still named as another note", async () => {
  const container = fakeContainer({ id: TAKEN, title: "Elsewhere" });
  // The repo reads one project; a note in another project is invisible to getPage but still holds the id.
  (container.vault as unknown as { getPage: () => Promise<null> }).getPage = async () => null;
  setContainerForTests(container);
  const result = await applyEntries(memoryFs().fs, batch(created("other.md", TAKEN)), {});
  assert.deepEqual(result.refused, [{ path: "other.md", reason: "id already used by another note" }]);
});

test("a refused file is listed with its reason by the next preview, not offered as new", async () => {
  setContainerForTests(fakeContainer({ id: TAKEN, title: "Losses" }));
  await applyEntries(memoryFs().fs, batch(created("again.md", TAKEN)), {});

  const next = setAsideRefused(batch(created("again.md", TAKEN), created("fresh.md")));
  assert.deepEqual(next.refused, [{ path: "again.md", reason: "id already used by Losses" }]);
  assert.deepEqual(next.entries.map((e: ImportDiffEntry) => e.entity.path), ["fresh.md"]);
  assert.equal(next.counts.created, 1);
});

test("a refused file whose id has since changed is offered again", async () => {
  setContainerForTests(fakeContainer());
  await applyEntries(memoryFs().fs, batch(created("fixed.md", BAD)), {});

  const fixed = "0b7c3f8e-3d2a-4c1b-9e8f-112233445566";
  const next = setAsideRefused(batch(created("fixed.md", fixed)));
  assert.deepEqual(next.refused, []);
  assert.deepEqual(next.entries.map((e: ImportDiffEntry) => e.entity.id), [fixed]);
  assert.equal(next.counts.created, 1);
});

test("a title the repo rejects is not mistaken for a bad id", async () => {
  const container = fakeContainer();
  (container.vault.manageVaultPage as unknown as { add: () => Promise<never> }).add = async () => {
    throw Object.assign(new Error("Page title is required."), { name: "VaultPageValidationError" });
  };
  setContainerForTests(container);
  await assert.rejects(applyEntries(memoryFs().fs, batch(created("x.md", TAKEN)), {}), /title is required/);
});
