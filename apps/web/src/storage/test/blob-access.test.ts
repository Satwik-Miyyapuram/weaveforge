import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BlobAccessError,
  assertAllowedBlobBucket,
  assertBlobPathOwned,
  resourceIdFromBlobPath,
} from "../server/blob-access";

/**
 * The guards carry their own status.
 *
 * Which HTTP refusal a guard deserves is a property of the guard — a malformed
 * path is a 400 whoever sends it, someone else's path is a 403 — and putting it
 * on the error is what lets the route branch on a type instead of matching
 * message text that a rewording can change.
 */
describe("BlobAccessError", () => {
  it("carries the status the caller deserves", () => {
    assert.throws(() => assertBlobPathOwned("../etc/passwd", "uid"), (err: unknown) => {
      assert.ok(err instanceof BlobAccessError);
      assert.equal(err.status, 400, "a malformed path is the request's fault, not the identity's");
      return true;
    });
    assert.throws(() => assertBlobPathOwned("other-user/paper/x.webp", "uid"), (err: unknown) => {
      assert.ok(err instanceof BlobAccessError);
      assert.equal(err.status, 403, "a different user could send this exact request successfully");
      return true;
    });
    assert.throws(() => assertAllowedBlobBucket("secrets"), (err: unknown) => {
      assert.ok(err instanceof BlobAccessError);
      assert.equal(err.status, 400);
      return true;
    });
  });
});

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
