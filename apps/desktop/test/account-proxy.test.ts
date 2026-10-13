import test from "node:test";
import assert from "node:assert/strict";
import { isAccountProxyRequest, proxyAccount } from "../src/account-proxy";
import { answerRelay } from "../src/app-relays";
import { BLOB_UPSTREAM } from "../src/blob-proxy";
import type { ProxyFetch } from "../src/semantic-scholar-proxy";

/**
 * Settings → Delete account on the desktop: the static bundle has no
 * `/api/account/*` routes, so the shell must relay both steps to the hosted
 * app. Before it did, the request fell through to the bundle's 404 page.
 */

const APP = "app://weaveforge";

function recording(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: ProxyFetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('{"ok":true,"emailHint":"sa***@x.org"}', { status, headers: { "content-type": "application/json" } }));
  };
  return { fetchFn, calls };
}

test("both deletion steps are relayed, and nothing else under /api/account", () => {
  assert.equal(isAccountProxyRequest(`${APP}/api/account/delete-user/otp`), true);
  assert.equal(isAccountProxyRequest(`${APP}/api/account/delete-user`), true);
  assert.equal(isAccountProxyRequest(`${APP}/api/account/delete-user/other`), false);
  assert.equal(isAccountProxyRequest(`${APP}/api/account`), false);
  assert.equal(isAccountProxyRequest(`${APP}/settings`), false);
});

test("the shell's dispatcher answers the code request instead of serving the bundle", async () => {
  const { fetchFn, calls } = recording();
  const relayed = answerRelay(
    new Request(`${APP}/api/account/delete-user/otp`, { method: "POST", headers: { authorization: "Bearer t" } }),
    fetchFn,
  );
  assert.ok(relayed, "the otp route must not fall through to the static bundle");
  const res = await relayed;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, emailHint: "sa***@x.org" });
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/account/delete-user/otp`);
});

test("the delete step carries its token and body, and no cookie", async () => {
  const { fetchFn, calls } = recording();
  const body = JSON.stringify({ confirmation: "DELETE_USER", otp: "123456" });
  await proxyAccount(
    new Request(`${APP}/api/account/delete-user`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json", cookie: "no" },
      body,
    }),
    fetchFn,
  );
  const init = calls[0]!.init!;
  const headers = init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, `${BLOB_UPSTREAM}/api/account/delete-user`);
  assert.equal(init.method, "POST");
  assert.equal(headers.authorization, "Bearer t");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers.cookie, undefined);
  assert.equal(new TextDecoder().decode(init.body as ArrayBuffer), body);
});

test("a server refusal passes through; other methods and a dead network do not throw", async () => {
  const refused = recording(401);
  const res = await proxyAccount(new Request(`${APP}/api/account/delete-user`, { method: "POST", body: "{}" }), refused.fetchFn);
  assert.equal(res.status, 401);
  assert.equal((await proxyAccount(new Request(`${APP}/api/account/delete-user`), refused.fetchFn)).status, 405);
  const dead = await proxyAccount(
    new Request(`${APP}/api/account/delete-user/otp`, { method: "POST" }),
    () => Promise.reject(new Error("offline")),
  );
  assert.equal(dead.status, 502);
});
