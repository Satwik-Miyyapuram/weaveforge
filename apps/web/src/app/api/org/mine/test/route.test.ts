import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

test("GET /api/org/mine: 401 without a bearer token", async () => {
  const res = await GET(new Request("http://localhost/api/org/mine"));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Not authenticated/);
});
