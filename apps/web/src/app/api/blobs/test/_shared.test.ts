import { test } from "node:test";
import assert from "node:assert/strict";
import { blobFailure, tieredBlobToken } from "../_shared";
import { BlobAccessError } from "@/storage/server/blob-access";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";

test("tieredBlobToken: 503 before it ever looks for a token", async () => {
  await withNonTieredBlobProvider(async () => {
    const gate = await tieredBlobToken(
      new Request("http://localhost/api/blobs/remove", { headers: { authorization: "Bearer tt_abc" } }),
    );
    assert.ok("refusal" in gate);
    if ("refusal" in gate) assert.equal(gate.refusal.status, 503);
  });
});

test("blobFailure: someone else's path is forbidden, not a server fault", async () => {
  const forbidden = blobFailure(new Error("Forbidden: path belongs to another user."));
  assert.equal(forbidden.status, 403);

  const unauthenticated = blobFailure(new Error("Not authenticated."));
  assert.equal(unauthenticated.status, 401);

  const fault = blobFailure(new Error("R2 refused the delete."));
  assert.equal(fault.status, 500);
  assert.match((await fault.json()).error, /R2 refused/);
});

// The guards in `storage/server/blob-access.ts` were plain `Error`s whose only
// machine-readable signal was their wording, so `blobFailure` had to match on
// the message to answer 403 instead of 500. They are typed now, and the type is
// what is read — a rewording, or the error-sanitising change below, can no
// longer turn a client mistake into a 500.

test("blobFailure: a malformed path is the caller's mistake, so it is a 400", () => {
  const res = blobFailure(new BlobAccessError("Invalid blob path.", 400));
  assert.equal(res.status, 400);
});

test("blobFailure: an unsupported bucket is a 400, not a server fault", async () => {
  const res = blobFailure(new BlobAccessError("Unsupported blob bucket.", 400));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unsupported blob bucket/);
});

test("blobFailure: a well-formed path aimed at someone else is a 403", () => {
  assert.equal(blobFailure(new BlobAccessError("Forbidden blob path.", 403)).status, 403);
});

test("blobFailure: a database fault is a 500 and does not leak the schema", async () => {
  // The class of error that used to reach a client verbatim.
  const res = blobFailure({
    message: 'new row violates row-level security policy for table "blob_objects"',
    code: "42501",
  });
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error: string };
  assert.doesNotMatch(body.error, /blob_objects/);
  assert.doesNotMatch(body.error, /row-level security/);
  assert.match(body.error, /42501/);
});
