import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PATCH, DELETE } from "../route";

test("GET /api/overleaf/reports: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/overleaf/reports"))).status, 401);
});

test("POST /api/overleaf/reports: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/overleaf/reports", { method: "POST" }))).status, 401);
});

test("PATCH /api/overleaf/reports: 401 without a token", async () => {
  assert.equal((await PATCH(new Request("http://localhost/api/overleaf/reports", { method: "PATCH" }))).status, 401);
});

test("DELETE /api/overleaf/reports: 401 without a token", async () => {
  assert.equal((await DELETE(new Request("http://localhost/api/overleaf/reports", { method: "DELETE" }))).status, 401);
});
