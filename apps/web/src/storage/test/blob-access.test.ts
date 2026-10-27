import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BLOB_STORAGE_BUCKETS,
  BlobAccessError,
  assertAllowedBlobBucket,
  sharedResourceFor,
  assertBlobPathOwned,
  resolveBlobTierForViewer,
  resourceIdFromBlobPath,
} from "../server/blob-access";
import { BLOB_SERVER_ENV, withEnv } from "./with-env";

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

/**
 * A failed lookup is not a missing blob (B58, 10-07): the content route tells
 * them apart, so a database or configuration fault is not reported as 404.
 */
describe("resolveBlobTierForViewer", () => {
  const OWNER = "11111111-1111-4111-8111-111111111111";
  const VIEWER = "22222222-2222-4222-8222-222222222222";
  const RES = "33333333-3333-4333-8333-333333333333";
  const path = `${OWNER}/${RES}/x.png`;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  function rest(rows: unknown, shared: unknown = false, status = 200) {
    return (async (url: string | URL | Request) =>
      String(url).includes("/rpc/shared_to_user") ? json(shared) : json(rows, status)) as typeof fetch;
  }

  it("answers the owner's tier", async () => {
    const tier = await withEnv(
      BLOB_SERVER_ENV,
      () => resolveBlobTierForViewer("paper-images", path, OWNER),
      rest([{ user_id: OWNER, tier: "cold" }]),
    );
    assert.equal(tier, "cold");
  });

  it("answers a viewer the paper is shared with", async () => {
    const tier = await withEnv(
      BLOB_SERVER_ENV,
      () => resolveBlobTierForViewer("paper-images", path, VIEWER),
      rest([{ user_id: OWNER, tier: "hot" }], true),
    );
    assert.equal(tier, "hot");
  });

  it("is null for no row, and for a viewer it is not shared with", async () => {
    assert.equal(
      await withEnv(BLOB_SERVER_ENV, () => resolveBlobTierForViewer("paper-images", path, OWNER), rest([])),
      null,
    );
    assert.equal(
      await withEnv(
        BLOB_SERVER_ENV,
        () => resolveBlobTierForViewer("paper-images", path, VIEWER),
        rest([{ user_id: OWNER, tier: "hot" }], false),
      ),
      null,
    );
  });

  it("throws when the lookup fails", async () => {
    const failing = rest({ message: "permission denied for table blob_objects", code: "42501" }, false, 500);
    await assert.rejects(
      withEnv(BLOB_SERVER_ENV, () => resolveBlobTierForViewer("paper-images", path, OWNER), failing),
    );
  });

  it("throws when the share check fails", async () => {
    const fetchStub = (async (url: string | URL | Request) =>
      String(url).includes("/rpc/")
        ? json({ message: "boom", code: "XX000" }, 500)
        : json([{ user_id: OWNER, tier: "hot" }])) as typeof fetch;
    await assert.rejects(
      withEnv(BLOB_SERVER_ENV, () => resolveBlobTierForViewer("paper-images", path, VIEWER), fetchStub),
    );
  });

  it("throws when the service key is not configured", async () => {
    await assert.rejects(
      withEnv({ ...BLOB_SERVER_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined }, () =>
        resolveBlobTierForViewer("paper-images", path, OWNER),
      ),
      /not configured/,
    );
  });
});

/** One bucket list (xhelp-27): the share map and the account purge read it too. */
describe("sharedResourceFor", () => {
  it("names the shared resource for every bucket", () => {
    assert.deepEqual(
      BLOB_STORAGE_BUCKETS.map((b) => [b, sharedResourceFor(b)]),
      [
        ["paper-images", "paper"],
        ["experiment-artifacts", "experiment"],
        ["vault-assets", "vault_page"],
        ["report-images", "report_section"],
        ["log-images", "log_entry"],
      ],
    );
  });

  it("is null for an unknown bucket, including Object.prototype names", () => {
    for (const b of ["", "avatars", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.equal(sharedResourceFor(b), null, b);
    }
  });
});
