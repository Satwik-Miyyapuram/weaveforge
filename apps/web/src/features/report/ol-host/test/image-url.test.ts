import assert from "node:assert/strict";
import test from "node:test";
import { fetchImageUrl } from "../image-url";

test("an Overleaf image is fetched (through the bridge) and handed back as a blob URL", async () => {
  const asked: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  const url = await fetchImageUrl("/project/p1/blob/abc", fetchFn);
  assert.deepEqual(asked, ["/project/p1/blob/abc"]);
  assert.match(url, /^blob:/);
  URL.revokeObjectURL(url);
});

test("a failed answer rejects, so the caller shows its error", async () => {
  const fetchFn = (async () => new Response("no", { status: 404 })) as typeof fetch;
  await assert.rejects(fetchImageUrl("/project/p1/blob/missing", fetchFn), /404/);
});
