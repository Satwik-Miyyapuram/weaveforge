import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

const url = "http://localhost/api/overleaf/workshop/pdf";

test("POST /api/overleaf/workshop/pdf: 401 without a token", async () => {
  assert.equal((await POST(new Request(url, { method: "POST", body: "{}" }))).status, 401);
});
