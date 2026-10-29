import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/overleaf/workshop/projects: 401 without a token", async () => {
  const response = await POST(new Request("http://localhost/api/overleaf/workshop/projects", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
});
