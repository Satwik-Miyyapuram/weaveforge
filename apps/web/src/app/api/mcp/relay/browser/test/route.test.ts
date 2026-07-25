import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

test("GET /api/mcp/relay/browser: 401 without a token", async () => {
  const res = await GET(new Request("http://localhost/api/mcp/relay/browser"));
  assert.equal(res.status, 401);
});
