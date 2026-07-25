import assert from "node:assert/strict";
import test from "node:test";
import { ZoteroAnnotations } from "../infrastructure/zotero-annotations";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("pullAll retains stable annotation keys and normalizes Zotero child notes", async () => {
  const urls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("itemType=attachment")) return response([{ key: "ATTACHMENT", data: { parentItem: "PAPER" } }]);
    if (url.includes("itemType=annotation")) return response([{ key: "ANNOTATION", data: { parentItem: "ATTACHMENT", annotationText: "Highlighted", tags: [{ tag: "method" }] } }]);
    if (url.includes("itemType=note")) return response([{ key: "NOTE", data: { parentItem: "PAPER", note: "<p>Research <strong>note</strong></p>" } }]);
    return response([]);
  };
  const result = await new ZoteroAnnotations(async () => ({ apiKey: "test", library: "users/1" }), fetchFn).pullAll();
  assert.deepEqual(result.get("PAPER"), [
    { key: "ANNOTATION", kind: "annotation", text: "Highlighted", comment: undefined, color: undefined, page: undefined, tags: ["method"] },
    { key: "NOTE", kind: "note", text: "Research note", tags: [] },
  ]);
  assert.ok(urls.every((url) => url.startsWith("https://api.zotero.org/users/1/items?")));
});

test("pullAll maps annotationPageLabel onto page", async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("itemType=attachment")) return response([{ key: "ATTACHMENT", data: { parentItem: "PAPER" } }]);
    if (url.includes("itemType=annotation")) {
      return response([
        {
          key: "A1",
          data: {
            parentItem: "ATTACHMENT",
            annotationText: "Quote",
            annotationPageLabel: "12",
          },
        },
      ]);
    }
    if (url.includes("itemType=note")) return response([]);
    return response([]);
  };
  const result = await new ZoteroAnnotations(async () => ({ apiKey: "test", library: "users/1" }), fetchFn).pullAll();
  assert.equal(result.get("PAPER")?.[0]?.page, "12");
});
