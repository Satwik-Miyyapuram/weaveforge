import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/sdk/metrics: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/sdk/metrics", { method: "POST" }))).status, 401);
});
