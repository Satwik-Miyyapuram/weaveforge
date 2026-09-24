import type { Paper } from "@weaveforge/core";
import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  ZOTERO_LOCAL_API_OFF,
  ZOTERO_NOT_RUNNING,
  localZoteroAnnotations,
  localZoteroLibrary,
  zoteroLocalFetch,
  zoteroLocalStatusMessage,
  usableStatus,
} from "../infrastructure/zotero-local";

function bridgeWith(
  reply: (url: string) => { status: number; body: string; headers: Record<string, string> },
): DesktopBridge {
  return { zoteroLocal: async (url: string) => reply(url) } as unknown as DesktopBridge;
}

test("the local fetch rebuilds a Response the pager can read", async () => {
  const fetchFn = zoteroLocalFetch(
    bridgeWith(() => ({ status: 200, body: "[]", headers: { "total-results": "7" } })),
  );
  const res = await fetchFn("http://127.0.0.1:23119/api/users/0/items");
  assert.equal(res.ok, true);
  assert.equal(res.headers.get("Total-Results"), "7");
  assert.deepEqual(await res.json(), []);
});

test("a shell that cannot reach Zotero says so in words a reader can act on", async () => {
  const fetchFn = zoteroLocalFetch({
    zoteroLocal: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:23119");
    },
  } as unknown as DesktopBridge);
  await assert.rejects(fetchFn("http://127.0.0.1:23119/api/users/0/items"), (error: Error) => {
    assert.match(error.message, new RegExp(ZOTERO_NOT_RUNNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // And the bridge's own reason travels with it. Replacing it wholesale sent
    // the reader to check a running Zotero when the real cause was a shell too
    // old to have the channel, a refused origin, or a rejected URL.
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
});

/**
 * A status `Response` refuses must not become a constructor error.
 *
 * `new Response("", { status: 304 })` throws `TypeError: Invalid response
 * status code 304` in Node and in browsers, and the shell forwards Zotero's raw
 * status — so a conditional read that Zotero answered perfectly well arrived at
 * the caller as a TypeError from a line it had no reason to suspect. 204, 205
 * and 304 are the three the constructor names; anything outside 200–599 is
 * refused too.
 */
test("a status the Response constructor refuses still becomes a response", async () => {
  assert.equal(usableStatus(304), 500);
  assert.equal(usableStatus(204), 500);
  assert.equal(usableStatus(205), 500);
  assert.equal(usableStatus(1000), 500);
  assert.equal(usableStatus(200), 200);
  assert.equal(usableStatus(404), 404);
  assert.equal(usableStatus(599), 599);

  const fetchFn = zoteroLocalFetch(bridgeWith(() => ({ status: 304, body: "", headers: {} })));
  const res = await fetchFn("http://127.0.0.1:23119/api/users/0/items");
  assert.equal(res.status, 500);
  // The wire status is kept beside it rather than lost.
  assert.equal(res.headers.get("x-weaveforge-status"), "304");
});

/**
 * The 403 that took two sessions to diagnose.
 *
 * Zotero answers `GET /connector/ping` with 200 while every `/api/...` path is
 * 403, because the local API is off — and the page used to report that as
 * "Zotero list fetch failed (403)", which names neither the cause nor the fix.
 * The message has to carry the preference and the restart, since the preference
 * is read only at startup and a reader who sets it without restarting will
 * conclude the instruction is wrong.
 */
test("a 403 from the local API names the preference and the restart", async () => {
  const fetchFn = zoteroLocalFetch(bridgeWith(() => ({ status: 403, body: "", headers: {} })));
  await assert.rejects(fetchFn("http://127.0.0.1:23119/api/users/0/items"), (error: Error) => {
    assert.match(error.message, /extensions\.zotero\.httpServer\.localAPI\.enabled/);
    assert.match(error.message, /Config Editor/);
    assert.match(error.message, /restart Zotero/i);
    assert.equal(error.message, ZOTERO_LOCAL_API_OFF);
    return true;
  });
});

test("only the 403 is translated; other statuses still reach the pager", async () => {
  assert.equal(zoteroLocalStatusMessage(403), ZOTERO_LOCAL_API_OFF);
  assert.equal(zoteroLocalStatusMessage(404), null);
  assert.equal(zoteroLocalStatusMessage(500), null);
  const fetchFn = zoteroLocalFetch(bridgeWith(() => ({ status: 500, body: "boom", headers: {} })));
  const res = await fetchFn("http://127.0.0.1:23119/api/users/0/items");
  assert.equal(res.status, 500);
  assert.equal(await res.text(), "boom");
});
test("annotations come back joined to their paper, with no API key involved", async () => {
  const page = (url: string): unknown[] => {
    if (url.includes("itemType=attachment")) {
      return [{ key: "ATT1", data: { parentItem: "PAP1" } }];
    }
    if (url.includes("itemType=annotation")) {
      return [
        {
          key: "ANN1",
          data: {
            parentItem: "ATT1",
            annotationType: "highlight",
            annotationText: "boiling water",
            tags: [{ tag: "method" }],
          },
        },
      ];
    }
    return [];
  };

  const seen: string[] = [];
  const byPaper = await localZoteroAnnotations(
    bridgeWith((url) => {
      seen.push(url);
      return { status: 200, body: JSON.stringify(page(url)), headers: {} };
    }),
  ).pullAll();

  assert.equal(byPaper.get("PAP1")?.[0]?.text, "boiling water");
  assert.ok(seen.every((url) => url.startsWith("http://127.0.0.1:23119/api/users/0/")));
});

test("the local library's items become papers, and only reads leave the page", async () => {
  // A local paper with no `zoteroKey` and no match in the local library — the
  // very thing a cloud sync would push, and then delete-propagate on the next
  // pass. The local read must do neither: the API refuses writes, and a paper
  // that is only in the cloud library is not gone.
  const elsewhere = {
    id: "p-cloud",
    title: "Only in the cloud",
    authors: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Paper;
  const seen: string[] = [];
  const added: string[] = [];
  const pulled = await localZoteroLibrary(
    bridgeWith((url) => {
      seen.push(url);
      const items = url.includes("/items/top")
        ? [{ data: { key: "PAP1", itemType: "preprint", title: "Boiling water", DOI: "10.1/x" } }]
        : [];
      return { status: 200, body: JSON.stringify(items), headers: { "total-results": "1" } };
    }),
    {
      listPapers: async () => [elsewhere],
      addPaper: async (input) => {
        added.push(input.title);
      },
    },
  ).pull();

  assert.equal(pulled, 1);
  assert.deepEqual(added, ["Boiling water"]);
  assert.ok(seen.every((url) => url.startsWith("http://127.0.0.1:23119/api/users/0/")));
  assert.ok(seen.every((url) => !url.includes("key=")), "no API key on a local read");
});

/**
 * A collection in the sync settings scopes the local read too.
 *
 * "Read Zotero on this computer" used to pull the whole library whatever the
 * project was set to: a reader syncing one collection from the cloud, who then
 * used the local import, got every item they owned. The setting is the same one
 * the cloud path reads — `projects.zotero_collection` — so the local path now
 * asks for the collection's top-level items rather than the library's.
 */
test("a chosen collection scopes the local library read", async () => {
  const seen: string[] = [];
  await localZoteroLibrary(
    bridgeWith((url) => {
      seen.push(url);
      const items = url.includes("/items/top")
        ? [{ data: { key: "PAP1", itemType: "preprint", title: "In the collection" } }]
        : [];
      return { status: 200, body: JSON.stringify(items), headers: { "total-results": "1" } };
    }),
    { listPapers: async () => [], addPaper: async () => {} },
    async () => "COL9",
  ).pull();

  assert.ok(
    seen.some((url) => url.includes("/collections/COL9/items/top")),
    `expected the collection endpoint, got ${seen.join(" ")}`,
  );
});

test("no collection means the whole library, as the cloud path does", async () => {
  const seen: string[] = [];
  await localZoteroLibrary(
    bridgeWith((url) => {
      seen.push(url);
      return { status: 200, body: "[]", headers: { "total-results": "0" } };
    }),
    { listPapers: async () => [], addPaper: async () => {} },
    async () => undefined,
  ).pull();

  assert.ok(
    seen.some((url) => url.includes("/items/top") && !url.includes("/collections/")),
    `expected the library endpoint, got ${seen.join(" ")}`,
  );
});

test("annotations are scoped to the same collection as the papers", async () => {
  const seen: string[] = [];
  await localZoteroAnnotations(
    bridgeWith((url) => {
      seen.push(url);
      return { status: 200, body: "[]", headers: {} };
    }),
    async () => "COL9",
  ).pullAll();

  // The pull reads the collection's top-level keys to know which parents count,
  // which is the read that makes the scope real rather than cosmetic.
  assert.ok(
    seen.some((url) => url.includes("/collections/COL9/items/top")),
    `expected a collection read, got ${seen.join(" ")}`,
  );
});
