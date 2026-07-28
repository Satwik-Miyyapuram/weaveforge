import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";

// All blob-tier routes fail closed with 503 unless BLOB_PROVIDER=tiered. The
// default dev/test provider is "supabase", so this guard runs before auth and
// input validation. The token/JSON/ownership paths are exercised in the tiered
// integration suite, not here.
test("POST /api/blobs/remove: 503 when the provider is not tiered", async () => {
  await withNonTieredBlobProvider(async () => {
    const res = await POST(new Request("http://localhost/api/blobs/remove", { method: "POST" }));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not tiered/);
  });
});
