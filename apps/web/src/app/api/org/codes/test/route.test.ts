import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../route";

test("GET /api/org/codes: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/org/codes"))).status, 401);
});

test("POST /api/org/codes: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/org/codes", { method: "POST" }))).status, 401);
});
