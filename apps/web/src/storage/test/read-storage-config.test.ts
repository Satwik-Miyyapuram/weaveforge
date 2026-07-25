import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readStorageConfig } from "../config";

describe("readStorageConfig", () => {
  it("defaults to supabase", () => {
    assert.equal(readStorageConfig({}).provider, "supabase");
  });

  it("reads tiered provider and R2 fields", () => {
    const c = readStorageConfig({
      NEXT_PUBLIC_BLOB_PROVIDER: "tiered",
      R2_ACCOUNT_ID: "acc",
      R2_BUCKET: "hot",
      BLOB_TIER_ALPHA: "2",
    });
    assert.equal(c.provider, "tiered");
    assert.equal(c.r2AccountId, "acc");
    assert.equal(c.tierAlpha, 2);
  });

  it("falls back BLOB_PROVIDER when NEXT_PUBLIC is unset", () => {
    assert.equal(readStorageConfig({ BLOB_PROVIDER: "tiered" }).provider, "tiered");
  });

  it("falls back on unknown provider", () => {
    assert.equal(readStorageConfig({ BLOB_PROVIDER: "s3" }).provider, "supabase");
  });
});
