import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../route";

const noAuth = (url: string, method: string) => new Request(url, { method });
const withToken = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { authorization: "Bearer tt_dummy", "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

test("GET /api/settings/api-tokens: 401 without a token", async () => {
  const res = await GET(noAuth("http://localhost/api/settings/api-tokens", "GET"));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Not authenticated/);
});

test("POST /api/settings/api-tokens: 401 without a token", async () => {
  const res = await POST(noAuth("http://localhost/api/settings/api-tokens", "POST"));
  assert.equal(res.status, 401);
});

test("POST /api/settings/api-tokens: 400 on malformed JSON (before hitting the service)", async () => {
  const res = await POST(withToken("http://localhost/api/settings/api-tokens", "POST", "{not json"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Invalid JSON body/);
});

test("DELETE /api/settings/api-tokens: 401 without a token", async () => {
  const res = await DELETE(noAuth("http://localhost/api/settings/api-tokens", "DELETE"));
  assert.equal(res.status, 401);
});

test("DELETE /api/settings/api-tokens: 400 when id query param is missing", async () => {
  const res = await DELETE(withToken("http://localhost/api/settings/api-tokens", "DELETE"));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Token id required/);
});
