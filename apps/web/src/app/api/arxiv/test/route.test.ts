import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

function stubFetch(handler: (url: string) => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(handler(String(input)))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("arxiv: 400 when id_list is missing", async () => {
  const res = await GET(new Request("http://localhost/api/arxiv"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /id_list is required/);
});

test("arxiv: proxies the Atom XML with the upstream status and atom content-type", async () => {
  const atom = `<?xml version="1.0"?><feed><entry><title>Paper</title></entry></feed>`;
  const restore = stubFetch((url) => {
    assert.match(url, /export\.arxiv\.org\/api\/query\?id_list=1706\.03762/);
    return new Response(atom, { status: 200 });
  });
  try {
    const res = await GET(new Request("http://localhost/api/arxiv?id_list=1706.03762"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/atom\+xml/);
    assert.equal(await res.text(), atom);
  } finally {
    restore();
  }
});

test("arxiv: preserves an upstream error status", async () => {
  const restore = stubFetch(() => new Response("busy", { status: 503 }));
  try {
    const res = await GET(new Request("http://localhost/api/arxiv?id_list=x"));
    assert.equal(res.status, 503);
  } finally {
    restore();
  }
});
