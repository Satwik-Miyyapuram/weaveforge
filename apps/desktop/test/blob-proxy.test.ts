import test from "node:test";
import assert from "node:assert/strict";
import { BLOB_UPSTREAM, isBlobProxyRequest, proxyBlob } from "../src/blob-proxy";
import type { ProxyFetch } from "../src/semantic-scholar-proxy";

/**
 * The shell's blob relay: the static bundle has no `/api/blobs/*` routes, so
 * the shell sends them to the hosted app with the token and the multipart
 * body intact, and nothing else goes along.
 */

const APP = "app://weaveforge";

function recording(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('{"ok":true}', { status, headers: { "content-type": "application/json" } }));
  };
  return { fetchFn, calls };
}

test("only the blob routes are the relay", () => {
  assert.equal(isBlobProxyRequest(`${APP}/api/blobs/upload`), true);
  assert.equal(isBlobProxyRequest(`${APP}/api/blobs-other`), false);
  assert.equal(isBlobProxyRequest(`${APP}/reader`), false);
});

test("an upload reaches the hosted app with its token and body", async () => {
  const { fetchFn, calls } = recording();
  const form = new FormData();
  form.set("path", "p/1.png");
  form.set("file", new Blob([new Uint8Array([1, 2, 3])]), "1.png");
  const req = new Request(`${APP}/api/blobs/upload`, {
    method: "POST",
    headers: { authorization: "Bearer t", cookie: "no" },
    body: form,
  });
  const type = req.headers.get("content-type");
  const res = await proxyBlob(req, fetchFn);
  assert.equal(res.status, 200);
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/blobs/upload`);
  const headers = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer t");
  assert.equal(headers["content-type"], type);
  assert.equal(headers.cookie, undefined);
  assert.ok((calls[0]!.init!.body as ArrayBuffer).byteLength > 3);
});

test("a GET keeps its query; other methods and odd paths are refused", async () => {
  const { fetchFn, calls } = recording();
  await proxyBlob(new Request(`${APP}/api/blobs/content?path=a%2Fb`), fetchFn);
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/blobs/content?path=a%2Fb`);
  assert.equal((await proxyBlob(new Request(`${APP}/api/blobs/upload`, { method: "DELETE" }), fetchFn)).status, 405);
  assert.equal((await proxyBlob(new Request(`${APP}/api/blobs/`), fetchFn)).status, 400);
});

test("a dead network is a 502, not a thrown error", async () => {
  const res = await proxyBlob(new Request(`${APP}/api/blobs/signed-urls`, { method: "POST", body: "{}" }), () =>
    Promise.reject(new Error("offline")),
  );
  assert.equal(res.status, 502);
});
