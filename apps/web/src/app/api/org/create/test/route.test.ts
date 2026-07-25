import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/org/create: 401 without a bearer token", async () => {
  const res = await POST(new Request("http://localhost/api/org/create", { method: "POST" }));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Not authenticated/);
});
