import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

// Fails closed with 503 unless BLOB_PROVIDER=tiered (default is "supabase"),
// ahead of auth/validation. Tiered paths are covered by the integration suite.
test("POST /api/blobs/signed-urls: 503 when the provider is not tiered", async () => {
  const res = await POST(new Request("http://localhost/api/blobs/signed-urls", { method: "POST" }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not tiered/);
});
