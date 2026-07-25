import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

// When the admin provisioner is configured (service role key present) a missing
// token yields 401; if it is not configured the route fails closed with 500.
// Either way an unauthenticated caller can never provision an account.
test("POST /api/admin/create-user: rejects an unauthenticated caller (401 or 500 fail-closed)", async () => {
  const res = await POST(new Request("http://localhost/api/admin/create-user", { method: "POST" }));
  assert.ok([401, 500].includes(res.status), `unexpected status ${res.status}`);
  assert.ok((await res.json()).error);
});
