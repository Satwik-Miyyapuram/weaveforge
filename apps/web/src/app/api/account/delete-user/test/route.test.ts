import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

// The route checks the admin provisioner (service role key) before anything
// else, so when it is unconfigured it fails closed with 500; when configured, a
// missing token yields 401. Either way an unauthenticated/unconfirmed caller
// can never delete an account. The 400 confirmation path needs the provisioner
// configured and is covered by integration.
test("POST /api/account/delete-user: rejects an unauthenticated caller (401 or 500 fail-closed)", async () => {
  const res = await POST(new Request("http://localhost/api/account/delete-user", { method: "POST" }));
  assert.ok([401, 500].includes(res.status), `unexpected status ${res.status}`);
  assert.ok((await res.json()).error);
});
