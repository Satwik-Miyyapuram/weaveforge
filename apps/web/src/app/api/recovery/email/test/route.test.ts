import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../route";

// Email recovery is dead under CRYPTO_ENABLED=false but the endpoint still
// exists; it must stay authenticated regardless.
test("GET /api/recovery/email: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/recovery/email"))).status, 401);
});

test("POST /api/recovery/email: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/recovery/email", { method: "POST" }))).status, 401);
});
