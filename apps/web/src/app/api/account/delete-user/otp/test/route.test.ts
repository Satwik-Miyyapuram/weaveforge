import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

test("POST /api/account/delete-user/otp: rejects an unauthenticated caller (401 or 500 fail-closed)", async () => {
  const res = await POST(new Request("http://localhost/api/account/delete-user/otp", { method: "POST" }));
  assert.ok([401, 500].includes(res.status), `unexpected status ${res.status}`);
  assert.ok((await res.json()).error);
});
