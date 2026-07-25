import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../route";

test("GET /api/sdk/experiments: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/sdk/experiments"))).status, 401);
});

test("POST /api/sdk/experiments: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/sdk/experiments", { method: "POST" }))).status, 401);
});

test("DELETE /api/sdk/experiments: 401 without a token", async () => {
  assert.equal((await DELETE(new Request("http://localhost/api/sdk/experiments", { method: "DELETE" }))).status, 401);
});
