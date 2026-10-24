import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../route";
import { dbError, fakeTokenBackend } from "@/lib/test/fake-token-backend";

test("GET /api/settings/mcp-tokens: 401 without a token", async () => {
  const res = await GET(new Request("http://localhost/api/settings/mcp-tokens"));
  assert.equal(res.status, 401);
});

test("POST /api/settings/mcp-tokens: 401 without a token", async () => {
  const res = await POST(new Request("http://localhost/api/settings/mcp-tokens", { method: "POST" }));
  assert.equal(res.status, 401);
});

test("DELETE /api/settings/mcp-tokens: 401 without a token", async () => {
  const res = await DELETE(new Request("http://localhost/api/settings/mcp-tokens", { method: "DELETE" }));
  assert.equal(res.status, 401);
});

test("DELETE /api/settings/mcp-tokens: 400 when id is missing (token present)", async () => {
  const res = await DELETE(
    new Request("http://localhost/api/settings/mcp-tokens", {
      method: "DELETE",
      headers: { authorization: "Bearer tt_dummy" },
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Token id required/);
});

test("GET /api/settings/mcp-tokens: 503, not 401, when the server has no service-role key", async () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await GET(
      new Request("http://localhost/api/settings/mcp-tokens", { headers: { authorization: "Bearer tt_dummy" } }),
    );
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
});

const authed = (method: string, query = "") =>
  new Request(`http://localhost/api/settings/mcp-tokens${query}`, { method, headers: { authorization: "Bearer jwt" } });

test("GET /api/settings/mcp-tokens: 401 for a rejected session", async (t) => {
  fakeTokenBackend(t, { user: null });
  const res = await GET(authed("GET"));
  assert.equal(res.status, 401);
});

test("DELETE /api/settings/mcp-tokens: 404 when the token does not exist", async (t) => {
  fakeTokenBackend(t, { user: "user-1", rest: () => new Response(null, { status: 204, headers: { "content-range": "*/0" } }) });
  const res = await DELETE(authed("DELETE", "?id=missing"));
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Token not found/);
});

test("GET /api/settings/mcp-tokens: a database error is a 500 with safe wording, not 401", async (t) => {
  fakeTokenBackend(t, { user: "user-1", rest: dbError("42501") });
  const res = await GET(authed("GET"));
  assert.equal(res.status, 500);
  const { error } = await res.json();
  assert.doesNotMatch(error, /internal detail/);
  assert.match(error, /\(42501\)/);
});

test("POST /api/settings/mcp-tokens: a database error is a 500, not 401", async (t) => {
  fakeTokenBackend(t, { user: "user-1", rest: dbError("23505") });
  const res = await POST(authed("POST"));
  assert.equal(res.status, 500);
});
