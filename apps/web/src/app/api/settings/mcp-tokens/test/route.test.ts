import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../route";

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
