import test from "node:test";
import assert from "node:assert/strict";
import { isArxivProxyRequest, proxyArxiv } from "../src/arxiv-proxy";
import type { ProxyFetch } from "../src/semantic-scholar-proxy";

/**
 * The shell's arXiv relay: the one path maps onto the Atom API and nowhere
 * else, only the id list travels, and a bad upstream answer is a 502 the
 * metadata source can report rather than a 404 from the bundle.
 */

const APP = "app://weaveforge";
const FEED = '<feed><entry><title>Layer Normalization</title></entry></feed>';

function answering(status: number) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(FEED, { status, headers: { "content-type": "application/atom+xml" } }));
  };
  return { fetchFn, calls };
}

test("only /api/arxiv is the relay", () => {
  assert.equal(isArxivProxyRequest(`${APP}/api/arxiv?id_list=1607.06450`), true);
  assert.equal(isArxivProxyRequest(`${APP}/api/arxiv/extra`), false);
  assert.equal(isArxivProxyRequest(`${APP}/reader/`), false);
});

test("forwards the id list to export.arxiv.org and returns the feed", async () => {
  const { fetchFn, calls } = answering(200);
  const res = await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=1607.06450&x=1`), fetchFn);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FEED);
  assert.equal(calls[0]?.url, "https://export.arxiv.org/api/query?id_list=1607.06450");
  assert.equal(calls[0]?.init?.method, "GET");
});

test("refuses a missing or oversized id list, and non-GET", async () => {
  const { fetchFn, calls } = answering(200);
  assert.equal((await proxyArxiv(new Request(`${APP}/api/arxiv`), fetchFn)).status, 400);
  assert.equal((await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=${"1".repeat(4_001)}`), fetchFn)).status, 400);
  assert.equal((await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=1`, { method: "POST" }), fetchFn)).status, 405);
  assert.equal(calls.length, 0);
});

test("an upstream failure is a 502, not the upstream's status", async () => {
  const { fetchFn } = answering(503);
  const res = await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=1607.06450`), fetchFn);
  assert.equal(res.status, 502);
  const failing: ProxyFetch = () => Promise.reject(new Error("offline"));
  assert.equal((await proxyArxiv(new Request(`${APP}/api/arxiv?id_list=1`), failing)).status, 502);
});
