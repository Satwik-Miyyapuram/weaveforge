import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/org/standalone: 401 without a token", async () => {
  const res = await POST(new Request("http://localhost/api/org/standalone", { method: "POST" }));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Not authenticated/);
});
