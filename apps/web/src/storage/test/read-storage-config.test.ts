import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readStorageConfig } from "../config";
import { withEnv } from "./with-env";

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

  it("an empty NEXT_PUBLIC_BLOB_PROVIDER does not hide BLOB_PROVIDER (10-15)", () => {
    assert.equal(readStorageConfig({ NEXT_PUBLIC_BLOB_PROVIDER: "", BLOB_PROVIDER: "tiered" }).provider, "tiered");
  });

  it("reads an empty R2 or cold setting as unset (10-15)", () => {
    const c = readStorageConfig({ R2_BUCKET: "", R2_ACCOUNT_ID: "acc", BLOB_COLD_ENDPOINT: "" });
    assert.equal(c.r2Bucket, undefined);
    assert.equal(c.coldEndpoint, undefined);
    assert.equal(c.r2AccountId, "acc");
  });

  it("reads process.env the same way as a passed env (10-16)", async () => {
    const vars = { NEXT_PUBLIC_BLOB_PROVIDER: "", BLOB_PROVIDER: "tiered", R2_BUCKET: "", BLOB_TIER_ALPHA: "3" };
    const fromProcess = await withEnv(vars, () => readStorageConfig());
    assert.deepEqual(fromProcess, readStorageConfig(vars));
    assert.equal(fromProcess.provider, "tiered");
    assert.equal(fromProcess.r2Bucket, undefined);
  });
});
