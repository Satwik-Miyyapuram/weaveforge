import test from "node:test";
import assert from "node:assert/strict";
import {
  isSemanticScholarProxyRequest,
  proxySemanticScholar,
  type ProxyFetch,
} from "../src/semantic-scholar-proxy";

/**
 * The shell's Semantic Scholar relay: the path maps onto the API host and
 * nowhere else, the key and body travel, and a 429 is retried here so the
 * renderer never sees the CORS-masked failure it would get in a page.
 */

const APP = "app://weaveforge";

function answering(statuses: number[], body = '{"ok":true}') {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 200;
    return Promise.resolve(
      new Response(body, { status, headers: { "content-type": "application/json" } }),
    );
  };
  return { fetchFn, calls };
}

const noWait = () => Promise.resolve();

test("only the relay prefix is the relay", () => {
  assert.equal(isSemanticScholarProxyRequest(`${APP}/api/semantic-scholar/graph/v1/paper/x`), true);
  assert.equal(isSemanticScholarProxyRequest(`${APP}/api/pdf-proxy?url=x`), false);
  assert.equal(isSemanticScholarProxyRequest(`${APP}/reader`), false);
});

test("a GET is forwarded to the API host with its query and key", async () => {
  const { fetchFn, calls } = answering([200]);
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/ARXIV:1?fields=title`, {
    headers: { "x-api-key": "k" },
  });
  const res = await proxySemanticScholar(req, fetchFn, noWait);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls[0]?.url, "https://api.semanticscholar.org/graph/v1/paper/ARXIV:1?fields=title");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "k");
  assert.equal(calls[0]?.init?.method, "GET");
});

test("a POST carries its body and content type", async () => {
  const { fetchFn, calls } = answering([200], "[]");
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/batch?fields=x`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"ids":["a"]}',
  });
  const res = await proxySemanticScholar(req, fetchFn, noWait);
  assert.equal(res.status, 200);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, '{"ids":["a"]}');
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
});

test("a 429 is retried before answering", async () => {
  const { fetchFn, calls } = answering([429, 429, 200]);
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`);
  const res = await proxySemanticScholar(req, fetchFn, noWait);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test("a persistent 429 is passed through as a 429", async () => {
  const { fetchFn, calls } = answering([429]);
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`);
  const res = await proxySemanticScholar(req, fetchFn, noWait);
  assert.equal(res.status, 429);
  assert.equal(calls.length, 4);
});

test("other methods, empty and traversal paths are refused without a call", async () => {
  const { fetchFn, calls } = answering([200]);
  for (const req of [
    new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`, { method: "DELETE" }),
    new Request(`${APP}/api/semantic-scholar/`),
    new Request(`${APP}/api/semantic-scholar/..%2Fetc`),
  ]) {
    const res = await proxySemanticScholar(req, fetchFn, noWait);
    assert.ok(res.status === 400 || res.status === 405, `status ${res.status}`);
  }
  assert.equal(calls.length, 0);
});

test("an upstream network failure is a 502", async () => {
  const fetchFn: ProxyFetch = () => Promise.reject(new Error("offline"));
  const req = new Request(`${APP}/api/semantic-scholar/graph/v1/paper/x`);
  const res = await proxySemanticScholar(req, fetchFn, noWait);
  assert.equal(res.status, 502);
});
