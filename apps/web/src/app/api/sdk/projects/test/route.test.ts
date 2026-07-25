import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

test("GET /api/sdk/projects: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/sdk/projects"))).status, 401);
});
