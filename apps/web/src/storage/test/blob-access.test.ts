import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertAllowedBlobBucket,
  assertBlobPathOwned,
  resourceIdFromBlobPath,
} from "../server/blob-access";

describe("resourceIdFromBlobPath", () => {
  it("reads the resource id out of `{owner}/{resource}/{file}`", () => {
    assert.equal(
      resourceIdFromBlobPath("owner-id/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/fig.webp"),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("returns null for invalid paths", () => {
    assert.equal(resourceIdFromBlobPath("only-one-segment"), null);
    assert.equal(resourceIdFromBlobPath("a/not-a-uuid/c.webp"), null);
  });
});

describe("assertBlobPathOwned", () => {
  const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("accepts paths under the user prefix", () => {
    assert.doesNotThrow(() => assertBlobPathOwned(`${uid}/paper-id/x.webp`, uid));
  });

  it("rejects traversal and foreign prefixes", () => {
    assert.throws(() => assertBlobPathOwned("../etc/passwd", uid), /Invalid blob path/);
    assert.throws(() => assertBlobPathOwned("other-user/paper/x.webp", uid), /Forbidden blob path/);
  });
});

describe("assertAllowedBlobBucket", () => {
  it("allows known buckets", () => {
    assert.doesNotThrow(() => assertAllowedBlobBucket("paper-images"));
    assert.doesNotThrow(() => assertAllowedBlobBucket("report-images"));
  });

  it("rejects unknown buckets", () => {
    assert.throws(() => assertAllowedBlobBucket("secrets"), /Unsupported blob bucket/);
  });
});
