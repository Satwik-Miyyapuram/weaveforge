import { test } from "node:test";
import assert from "node:assert/strict";
import { POST, DELETE } from "../route";

const url = "http://localhost/api/overleaf/workshop/session";

test("POST /api/overleaf/workshop/session: 401 without a token", async () => {
  assert.equal((await POST(new Request(url, { method: "POST", body: "{}" }))).status, 401);
});

test("DELETE /api/overleaf/workshop/session: 401 without a token", async () => {
  assert.equal((await DELETE(new Request(`${url}?id=x`, { method: "DELETE" }))).status, 401);
});
