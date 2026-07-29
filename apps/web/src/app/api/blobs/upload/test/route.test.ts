import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";

// Fails closed with 503 unless BLOB_PROVIDER=tiered (default is "supabase"),
// ahead of auth/multipart parsing. Tiered paths are covered by integration.
test("POST /api/blobs/upload: 503 when the provider is not tiered", async () => {
  await withNonTieredBlobProvider(async () => {
    const res = await POST(new Request("http://localhost/api/blobs/upload", { method: "POST" }));
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not tiered/);
  });
});
