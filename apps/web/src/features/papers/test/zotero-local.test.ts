import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { ZOTERO_NOT_RUNNING, localZoteroAnnotations, zoteroLocalFetch } from "../infrastructure/zotero-local";

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
