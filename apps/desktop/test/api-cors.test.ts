/**
 * The shell's CORS rewrite for the API.
 *
 * What is tested is the two pure rewrites: what the request looks like when it
 * leaves, and what the response looks like when the renderer sees it. The
 * `webRequest` hooks that apply them are Electron's and are not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRESENTED_ORIGIN,
  inboundHeaders,
  isApiHost,
  outboundHeaders,
} from "../src/api-cors";

const APP = "app://weaveforge";

test("api cors: only the API's hosts are touched", () => {
  assert.equal(isApiHost("https://api.weaveforge.org/auth/v1/token"), true);
  assert.equal(isApiHost("https://weaveforge.org/"), true);
  assert.equal(isApiHost("https://export.arxiv.org/api/query"), false);
  assert.equal(isApiHost("https://notweaveforge.org/"), false);
  assert.equal(isApiHost("not a url"), false);
});

test("api cors: the request leaves as the deployment, whatever the page's origin", () => {
  // The bug: the deployed allow-list did not name `app://weaveforge`, the
  // preflight came back 403, and the installed app could not sign in.
  const sent = outboundHeaders({ Origin: APP, Authorization: "Bearer t", apikey: "k" });
  assert.equal(sent.Origin, PRESENTED_ORIGIN);
  assert.equal(sent.Authorization, "Bearer t", "every other header is kept");
  assert.equal(sent.apikey, "k");
});

test("api cors: a lowercase origin header is replaced, not duplicated", () => {
  const sent = outboundHeaders({ origin: APP });
  assert.deepEqual(Object.keys(sent), ["Origin"]);
  assert.equal(sent.Origin, PRESENTED_ORIGIN);
});

test("api cors: a request that carries no origin is left alone", () => {
  const plain = { Accept: "*/*" };
  assert.equal(outboundHeaders(plain), plain);
});

test("api cors: the answer comes back addressed to the page that asked", () => {
  const seen = inboundHeaders(
    {
      "access-control-allow-origin": [PRESENTED_ORIGIN],
      "access-control-allow-headers": ["authorization, apikey, content-type"],
      "access-control-expose-headers": ["content-range"],
      "content-type": ["application/json"],
    },
    APP,
  );
  assert.deepEqual(seen["access-control-allow-origin"], [APP]);
  // Caddy's explicit list is what lets `Authorization` through; it must survive.
  assert.deepEqual(seen["access-control-allow-headers"], ["authorization, apikey, content-type"]);
  assert.deepEqual(seen["access-control-expose-headers"], ["content-range"]);
  assert.deepEqual(seen["content-type"], ["application/json"]);
});

test("api cors: a differently-cased allow-origin does not survive beside the new one", () => {
  // Two allow-origin headers is an ambiguous answer the browser refuses.
  const seen = inboundHeaders({ "Access-Control-Allow-Origin": [PRESENTED_ORIGIN] }, APP);
  const names = Object.keys(seen).filter((k) => k.toLowerCase() === "access-control-allow-origin");
  assert.deepEqual(names, ["access-control-allow-origin"]);
  assert.deepEqual(seen["access-control-allow-origin"], [APP]);
});

test("api cors: a refusal with no allow-origin at all still gets one", () => {
  const seen = inboundHeaders({ "content-length": ["0"] }, APP);
  assert.deepEqual(seen["access-control-allow-origin"], [APP]);
});
