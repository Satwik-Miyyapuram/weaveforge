import test from "node:test";
import assert from "node:assert/strict";
import { isOverleafProxyRequest, proxyOverleaf } from "../src/overleaf-proxy";
import { answerRelay } from "../src/app-relays";
import { BLOB_UPSTREAM } from "../src/blob-proxy";
import type { ProxyFetch } from "../src/proxy-shared";

/**
 * Overleaf Workshop on the desktop: the static bundle has no
 * `/api/overleaf/workshop/*` routes (they seal the Overleaf session on the
 * server), so the shell relays exactly those to the hosted app.
 */

const APP = "app://weaveforge";

function recording(status = 200, body = '{"ok":true}', type = "application/json") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status, headers: { "content-type": type } }));
  };
  return { fetchFn, calls };
}

test("only the four Workshop routes are relayed", () => {
  for (const route of ["session", "projects", "compile", "pdf"]) {
    assert.equal(isOverleafProxyRequest(`${APP}/api/overleaf/workshop/${route}`), true, route);
  }
  assert.equal(isOverleafProxyRequest(`${APP}/api/overleaf/workshop/session?id=abc`), true);
  assert.equal(isOverleafProxyRequest(`${APP}/api/overleaf/workshop/other`), false);
  assert.equal(isOverleafProxyRequest(`${APP}/api/overleaf/workshop/session/x`), false);
  assert.equal(isOverleafProxyRequest(`${APP}/api/overleaf/reports`), false);
  assert.equal(isOverleafProxyRequest(`${APP}/report`), false);
});

test("the dispatcher relays a sign-in with its token and body, and no cookie", async () => {
  const { fetchFn, calls } = recording();
  const body = JSON.stringify({ cookie: "overleaf_session2=s" });
  const relayed = answerRelay(
    new Request(`${APP}/api/overleaf/workshop/session`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json", cookie: "no" },
      body,
    }),
    fetchFn,
  );
  assert.ok(relayed, "the session route must not fall through to the static bundle");
  assert.equal((await relayed).status, 200);
  const init = calls[0]!.init!;
  const headers = init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/overleaf/workshop/session`);
  assert.equal(headers.authorization, "Bearer t");
  assert.equal(headers.cookie, undefined);
  assert.equal(new TextDecoder().decode(init.body as ArrayBuffer), body);
});

test("forgetting a session keeps its id in the query", async () => {
  const { fetchFn, calls } = recording();
  const res = await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/session?id=abc`, { method: "DELETE" }), fetchFn);
  assert.equal(res.status, 200);
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/overleaf/workshop/session?id=abc`);
  assert.equal(calls[0]!.init!.method, "DELETE");
});

test("the compiled PDF comes back as bytes", async () => {
  const { fetchFn } = recording(200, "%PDF-1.7", "application/pdf");
  const res = await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/pdf`, { method: "POST", body: "{}" }), fetchFn);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(await res.text(), "%PDF-1.7");
});

test("other methods are refused; a refusal and a dead network pass through without throwing", async () => {
  const { fetchFn, calls } = recording(401);
  assert.equal((await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/compile`), fetchFn)).status, 405);
  assert.equal((await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/pdf`, { method: "DELETE" }), fetchFn)).status, 405);
  assert.equal(calls.length, 0);
  assert.equal((await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/compile`, { method: "POST", body: "{}" }), fetchFn)).status, 401);
  const dead = await proxyOverleaf(new Request(`${APP}/api/overleaf/workshop/projects`, { method: "POST" }), () => Promise.reject(new Error("offline")));
  assert.equal(dead.status, 502);
});
