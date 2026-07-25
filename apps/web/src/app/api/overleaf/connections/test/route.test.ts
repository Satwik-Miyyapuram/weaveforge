import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../route";

test("GET /api/overleaf/connections: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/overleaf/connections"))).status, 401);
});

test("POST /api/overleaf/connections: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/overleaf/connections", { method: "POST" }))).status, 401);
});

test("DELETE /api/overleaf/connections: 401 without a token", async () => {
  assert.equal((await DELETE(new Request("http://localhost/api/overleaf/connections", { method: "DELETE" }))).status, 401);
});
