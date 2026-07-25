import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../route";

// Default dev/test storage provider is "supabase", so the tiered-only content
// route short-circuits with 503 before any token handling. (When BLOB_PROVIDER
// is "tiered" it instead 400s on a missing token — covered by e2e/integration.)
test("GET /api/blobs/content: 503 when the provider is not tiered", async () => {
  const res = await GET(new Request("http://localhost/api/blobs/content"));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not tiered/);
});
