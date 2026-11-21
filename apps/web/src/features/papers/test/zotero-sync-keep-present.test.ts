/**
 * A paper whose Zotero item is missing from the sync's read but still in the
 * library is kept (P1-13). The read covers one collection's titled top-level
 * items, so an item moved to another collection, or one that lost its title,
 * used to look deleted and took the local paper with it.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { Paper } from "@weaveforge/core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { ZoteroSync } from "../infrastructure/parts-3";

before(loadTestCore);

const NEW_ITEM = { key: "NEW1", itemType: "journalArticle", title: "In this collection" };

/** Zotero: the collection read holds NEW1; the whole library holds `libraryKeys`. */
function zotero(libraryKeys: string[]) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("format=keys")) return new Response(libraryKeys.join("\n"), { status: 200 });
    return new Response(JSON.stringify([{ data: NEW_ITEM }]), {
      status: 200,
      headers: { "Total-Results": "1" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, urls };
}

function paper(id: string, zoteroKey: string): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    status: "to_read",
    metadata: { zoteroKey },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Paper;
}

function syncWith(fetchFn: typeof fetch, local: Paper[]) {
  const deleted: string[] = [];
  const sync = new ZoteroSync({
    credentials: async () => ({ apiKey: "k", library: "users/1", collection: "COLB" }),
    listPapers: async () => local,
    addPaper: async () => undefined,
    deletePaper: async (id) => void deleted.push(id),
    fetchFn,
    baseUrl: "https://api.zotero.org",
  });
  return { sync, deleted };
}

test("a paper whose item is elsewhere in the library is kept and counted", async () => {
  // OLD1 sits in another collection (or is untitled): absent from the read,
  // present in the library.
  const { fetchFn, urls } = zotero(["NEW1", "OLD1"]);
  const { sync, deleted } = syncWith(fetchFn, [paper("p-old", "OLD1")]);

  const result = await sync.sync();

  assert.deepEqual(deleted, []);
  assert.equal(result.deletedLocal, 0);
  assert.equal(result.deletesSkipped, 1);
  const keysRead = urls.find((u) => u.includes("format=keys"));
  assert.ok(keysRead && !keysRead.includes("collections/"), `library-wide keys read, got ${keysRead}`);
});

test("a paper whose item is gone from the whole library is still deleted", async () => {
  const { fetchFn } = zotero(["NEW1"]);
  const { sync, deleted } = syncWith(fetchFn, [paper("p-gone", "GONE1")]);

  const result = await sync.sync();

  assert.deepEqual(deleted, ["p-gone"]);
  assert.equal(result.deletedLocal, 1);
  assert.equal(result.deletesSkipped, 0);
});

test("no keys read when nothing is planned for deletion", async () => {
  const { fetchFn, urls } = zotero(["NEW1"]);
  const { sync } = syncWith(fetchFn, []);

  await sync.sync();

  assert.ok(!urls.some((u) => u.includes("format=keys")));
});

test("a leftover attachment row is still deleted: the keys read is top-level only", async () => {
  // An older sync made a paper from attachment ATT1. Zotero's `/items` keys
  // include child items, `/items/top` keys do not; only the second says the
  // row is not a paper still in the library.
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("format=keys")) {
      return new Response(url.includes("/items/top") ? "NEW1\n" : "NEW1\nATT1\n", { status: 200 });
    }
    return new Response(JSON.stringify([{ data: NEW_ITEM }]), {
      status: 200,
      headers: { "Total-Results": "1" },
    });
  }) as unknown as typeof fetch;
  const { sync, deleted } = syncWith(fetchFn, [paper("junk", "ATT1")]);

  await sync.sync();

  assert.deepEqual(deleted, ["junk"]);
});