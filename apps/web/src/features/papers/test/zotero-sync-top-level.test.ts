import { test } from "node:test";
import assert from "node:assert/strict";
import type { NewPaperInput, Paper } from "@weaveforge/core";
import { ZoteroSync } from "../infrastructure/zotero-sync";

/**
 * Every Zotero item the library holds, keyed by endpoint path. The mock serves
 * `/items` and `/items/top` differently, exactly as Zotero does — which is the
 * whole point of these tests.
 */
const PAPER = {
  key: "PAPER1",
  itemType: "preprint",
  title: "Attention Is All You Need",
  DOI: "10.48550/arXiv.1706.03762",
  creators: [{ firstName: "Ashish", lastName: "Vaswani" }],
};
const ATTACHMENT = { key: "ATT1", itemType: "attachment", parentItem: "PAPER1", title: "Preprint PDF" };
const NOTE = { key: "NOTE1", itemType: "note", parentItem: "PAPER1", title: "Some note" };

function mockLibrary() {
  const requested: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const isTop = url.includes("/items/top");
    const data = isTop ? [PAPER] : [PAPER, ATTACHMENT, NOTE];
    return new Response(JSON.stringify(data.map((d) => ({ data: d }))), {
      status: 200,
      headers: { "Total-Results": String(data.length) },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, requested };
}

function syncWith(fetchFn: typeof fetch, local: Paper[] = []) {
  const added: NewPaperInput[] = [];
  const sync = new ZoteroSync({
    credentials: async () => ({ apiKey: "k", library: "users/1" }),
    listPapers: async () => local,
    addPaper: async (input) => {
      added.push(input);
    },
    fetchFn,
    baseUrl: "https://api.zotero.org",
  });
  return { sync, added };
}

test("zotero sync: a PDF attachment is never imported as a paper", async () => {
  const { fetchFn } = mockLibrary();
  const { sync, added } = syncWith(fetchFn);

  const result = await sync.sync();

  const titles = added.map((p) => p.title);
  assert.ok(
    !titles.includes("Preprint PDF"),
    `an attachment was imported as a paper: ${JSON.stringify(titles)}`,
  );
  assert.ok(!titles.includes("Some note"), "a child note was imported as a paper");
  assert.deepEqual(titles, ["Attention Is All You Need"]);
  assert.equal(result.pulled, 1);
});

test("zotero sync: reads the top-level endpoint, not every item", async () => {
  const { fetchFn, requested } = mockLibrary();
  const { sync } = syncWith(fetchFn);
  await sync.sync();

  const reads = requested.filter((u) => !u.includes("POST"));
  assert.ok(
    reads.some((u) => u.includes("/items/top")),
    `expected a /items/top read, got ${JSON.stringify(reads)}`,
  );
});

test("zotero sync: a collection scopes to that collection's top-level items", async () => {
  const requested: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response(JSON.stringify([{ data: PAPER }]), {
      status: 200,
      headers: { "Total-Results": "1" },
    });
  }) as unknown as typeof fetch;

  const sync = new ZoteroSync({
    credentials: async () => ({ apiKey: "k", library: "users/1", collection: "COL9" }),
    listPapers: async () => [],
    addPaper: async () => {},
    fetchFn,
    baseUrl: "https://api.zotero.org",
  });
  await sync.sync();

  assert.ok(
    requested[0]!.includes("/collections/COL9/items/top"),
    `expected the collection's top-level endpoint, got ${requested[0]}`,
  );
});

test("zotero sync: an attachment reaching the filter anyway is still refused", async () => {
  // Guards the second line of defence independently of the endpoint choice.
  const fetchFn = (async () =>
    new Response(JSON.stringify([{ data: PAPER }, { data: ATTACHMENT }]), {
      status: 200,
      headers: { "Total-Results": "2" },
    })) as unknown as typeof fetch;

  const { sync, added } = syncWith(fetchFn);
  await sync.sync();

  assert.deepEqual(added.map((p) => p.title), ["Attention Is All You Need"]);
});
