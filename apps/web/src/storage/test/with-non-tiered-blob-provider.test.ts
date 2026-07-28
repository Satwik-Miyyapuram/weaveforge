import { test } from "node:test";
import assert from "node:assert/strict";
import { withNonTieredBlobProvider } from "./with-non-tiered-blob-provider.js";

test("withNonTieredBlobProvider restores prior env", async () => {
  const prev = process.env.BLOB_PROVIDER;
  process.env.BLOB_PROVIDER = "tiered";
  process.env.NEXT_PUBLIC_BLOB_PROVIDER = "tiered";
  await withNonTieredBlobProvider(async () => {
    assert.equal(process.env.BLOB_PROVIDER, "supabase");
    assert.equal(process.env.NEXT_PUBLIC_BLOB_PROVIDER, undefined);
  });
  assert.equal(process.env.BLOB_PROVIDER, "tiered");
  assert.equal(process.env.NEXT_PUBLIC_BLOB_PROVIDER, "tiered");
  if (prev === undefined) delete process.env.BLOB_PROVIDER;
  else process.env.BLOB_PROVIDER = prev;
});
