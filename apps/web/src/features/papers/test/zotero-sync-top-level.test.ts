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
  const deleted: string[] = [];
  const sync = new ZoteroSync({
    credentials: async () => ({ apiKey: "k", library: "users/1" }),
    listPapers: async () => local,
    addPaper: async (input) => {
      added.push(input);
    },
    deletePaper: async (id) => {
      deleted.push(id);
    },
    fetchFn,
    baseUrl: "https://api.zotero.org",
  });
  return { sync, added, deleted };
}

function paper(over: Partial<Paper>): Paper {
  return {
    id: "p1",
    title: "Untitled",
    authors: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as Paper;
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

test("zotero sync: a leftover attachment row is deleted, never pushed back", async () => {
  // The row an older sync created from ATT1: attachment title, attachment key,
  // no DOI. Its key is absent from /items/top (attachments are child items), so
  // the sync must read that as "gone from Zotero" and delete it locally —
  // pushing it would create a top-level "Preprint PDF" item that the next pull
  // imports as a real paper, and the junk never leaves.
  const posted: unknown[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ successful: {} }), { status: 200 });
    }
    return new Response(JSON.stringify([{ data: PAPER }]), {
      status: 200,
      headers: { "Total-Results": "1" },
    });
  }) as unknown as typeof fetch;

  const leftover = paper({
    id: "junk",
    title: "Preprint PDF",
    metadata: { zoteroKey: "ATT1" },
  });
  const { sync, deleted } = syncWith(fetchFn, [leftover]);
  const result = await sync.sync();

  assert.deepEqual(posted, [], `a leftover attachment row was pushed to Zotero: ${JSON.stringify(posted)}`);
  assert.equal(result.pushed, 0);
  assert.deepEqual(deleted, ["junk"]);
});

test("zotero sync: an item with a parentItem is not a paper, whatever its type says", async () => {
  const child = { key: "C1", itemType: "journalArticle", parentItem: "PAPER1", title: "SAGE PDF Full Text" };
  const fetchFn = (async () =>
    new Response(JSON.stringify([{ data: PAPER }, { data: child }]), {
      status: 200,
      headers: { "Total-Results": "2" },
    })) as unknown as typeof fetch;

  const { sync, added } = syncWith(fetchFn);
  await sync.sync();

  assert.deepEqual(added.map((p) => p.title), ["Attention Is All You Need"]);
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

/**
 * A Zotero write takes at most 50 objects (25-03), and only the items Zotero
 * accepted count as pushed (25-10).
 */
function mockPushLibrary(refuse: (index: number) => boolean = () => false) {
  const posts: unknown[][] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      const items = JSON.parse(String(init.body)) as unknown[];
      posts.push(items);
      const successful: Record<string, { key: string }> = {};
      const failed: Record<string, { message: string }> = {};
      items.forEach((_, i) => {
        const global = (posts.length - 1) * 50 + i;
        if (refuse(global)) failed[String(i)] = { message: "bad" };
        else successful[String(i)] = { key: `K${global}` };
      });
      return new Response(JSON.stringify({ successful, failed }), { status: 200 });
    }
    void input;
    return new Response("[]", { status: 200, headers: { "Total-Results": "0" } });
  }) as unknown as typeof fetch;
  return { fetchFn, posts };
}

function pushSync(fetchFn: typeof fetch, local: Paper[]) {
  const saved = new Map<string, string>();
  const sync = new ZoteroSync({
    credentials: async () => ({ apiKey: "k", library: "users/1" }),
    listPapers: async () => local,
    addPaper: async () => {},
    savePaper: async (p) => {
      saved.set(p.id, String(p.metadata?.["zoteroKey"]));
    },
    fetchFn,
    baseUrl: "https://api.zotero.org",
  });
  return { sync, saved };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => paper({ id: `p${i}`, title: `Paper ${i}` }));

test("zotero sync: 120 new papers go up in three writes of at most 50 (25-03)", async () => {
  const { fetchFn, posts } = mockPushLibrary();
  const { sync, saved } = pushSync(fetchFn, many(120));
  const result = await sync.sync();
  assert.deepEqual(posts.map((p) => p.length), [50, 50, 20]);
  assert.equal(result.pushed, 120);
  assert.equal(saved.size, 120);
  assert.equal(saved.get("p0"), "K0");
  assert.equal(saved.get("p75"), "K75");
  assert.equal(saved.get("p119"), "K119");
});

test("zotero sync: exactly 50 new papers is one write", async () => {
  const { fetchFn, posts } = mockPushLibrary();
  const { sync } = pushSync(fetchFn, many(50));
  await sync.sync();
  assert.deepEqual(posts.map((p) => p.length), [50]);
});

test("zotero sync: items Zotero refused are not counted as pushed (25-10)", async () => {
  const { fetchFn } = mockPushLibrary((i) => i === 3 || i === 60);
  const { sync, saved } = pushSync(fetchFn, many(70));
  const result = await sync.sync();
  assert.equal(result.pushed, 68);
  assert.equal(saved.has("p3"), false);
  assert.equal(saved.has("p60"), false);
  assert.equal(saved.get("p61"), "K61");
});

test("zotero sync: a write Zotero refused entirely pushes nothing (25-10)", async () => {
  const { fetchFn } = mockPushLibrary(() => true);
  const { sync, saved } = pushSync(fetchFn, many(3));
  const result = await sync.sync();
  assert.equal(result.pushed, 0);
  assert.equal(saved.size, 0);
});
