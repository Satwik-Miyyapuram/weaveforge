import type { Paper } from "@weaveforge/core";
import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import {
  ZOTERO_NOT_RUNNING,
  localZoteroAnnotations,
  localZoteroLibrary,
  zoteroLocalFetch,
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
    assert.equal(error.message, ZOTERO_NOT_RUNNING);
    return true;
  });
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
