import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/org/switch: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/org/switch", { method: "POST" }))).status, 401);
});
