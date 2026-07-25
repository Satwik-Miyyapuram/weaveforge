import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/sdk/artifacts: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/sdk/artifacts", { method: "POST" }))).status, 401);
});
