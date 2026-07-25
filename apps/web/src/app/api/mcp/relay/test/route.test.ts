import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PATCH } from "../route";

test("POST /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/mcp/relay", { method: "POST" }))).status, 401);
});

test("GET /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/mcp/relay"))).status, 401);
});

test("PATCH /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await PATCH(new Request("http://localhost/api/mcp/relay", { method: "PATCH" }))).status, 401);
});
