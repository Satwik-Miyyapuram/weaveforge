import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setContainerForTests } from "@/bootstrap";
import { invalidateAllRepoCaches, invalidateForWrite, setActiveProjectIdForCache } from "@/lib/cache/parts-1";
import { loadTestCore } from "@/lib/test/load-test-core";
import { loadCiteLinkCatalog } from "@/lib/hooks/use-cite-links";

const loads = { papers: 0, vault: 0, report: 0 };
let noteTitle = "First";

function container() {
  return {
    papers: { loadScreenData: async () => (loads.papers++, { papers: [] }) },
    vault: { loadScreenData: async () => (loads.vault++, { flat: [{ id: "n1", title: noteTitle }] }) },
    report: { loadScreenData: async () => (loads.report++, { flat: [] }) },
  };
}

before(async () => {
  await loadTestCore();
});
after(() => setContainerForTests(null));

test("editors and ink layers mounted together share one workspace scan", async () => {
  setContainerForTests(container() as never);
  const before = { ...loads };
  const all = await Promise.all([loadCiteLinkCatalog(), loadCiteLinkCatalog(), loadCiteLinkCatalog()]);
  assert.equal(loads.vault - before.vault, 1);
  assert.equal(loads.papers - before.papers, 1);
  assert.equal(all[2]!.notes[0]!.title, "First");
  // A mode switch remounts them: still no new scan.
  await loadCiteLinkCatalog();
  assert.equal(loads.vault - before.vault, 1);
});

test("a file write drops the shared catalog, so a new title shows", async () => {
  setContainerForTests(container() as never);
  await loadCiteLinkCatalog();
  noteTitle = "Renamed";
  invalidateAllRepoCaches();
  assert.equal((await loadCiteLinkCatalog()).notes[0]!.title, "Renamed");
});

test("a scoped note write drops it too", async () => {
  setContainerForTests(container() as never);
  await loadCiteLinkCatalog();
  noteTitle = "Scoped";
  invalidateForWrite("vault_page");
  assert.equal((await loadCiteLinkCatalog()).notes[0]!.title, "Scoped");
});

test("a new container loads its own catalog", async () => {
  setContainerForTests(container() as never);
  await loadCiteLinkCatalog();
  const before = loads.vault;
  setContainerForTests(container() as never);
  await loadCiteLinkCatalog();
  assert.equal(loads.vault - before, 1);
});

test("another project loads its own catalog", async () => {
  setContainerForTests(container() as never);
  let pid = "A";
  setActiveProjectIdForCache(() => pid);
  await loadCiteLinkCatalog();
  const before = loads.vault;
  pid = "B";
  await loadCiteLinkCatalog();
  assert.equal(loads.vault - before, 1);
  setActiveProjectIdForCache(() => null);
});
