import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

test("GET /api/org/memberships: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/org/memberships"))).status, 401);
});
