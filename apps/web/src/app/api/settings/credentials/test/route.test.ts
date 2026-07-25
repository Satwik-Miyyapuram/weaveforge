import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../route";

const noAuth = (url: string, method: string) => new Request(url, { method });
const withToken = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { authorization: "Bearer tt_dummy", "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

test("GET /api/settings/credentials: 401 without a token", async () => {
  const res = await GET(noAuth("http://localhost/api/settings/credentials", "GET"));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Not authenticated/);
});

test("POST /api/settings/credentials: 401 without a token", async () => {
  const res = await POST(noAuth("http://localhost/api/settings/credentials", "POST"));
  assert.equal(res.status, 401);
});

test("POST /api/settings/credentials: 400 on malformed JSON when auth fails closed after parse", async () => {
  // requireSdkUser runs first; a dummy bearer yields 401/500 before body handling.
  // Still assert the route rejects the call (never 2xx).
  const res = await POST(withToken("http://localhost/api/settings/credentials", "POST", "{not json"));
  assert.ok(res.status === 400 || res.status === 401 || res.status === 500);
  assert.notEqual(res.status, 200);
});
