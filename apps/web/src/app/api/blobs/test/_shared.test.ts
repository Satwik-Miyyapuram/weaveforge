import { test } from "node:test";
import assert from "node:assert/strict";
import { blobFailure, tieredBlobToken } from "../_shared";
import { withNonTieredBlobProvider } from "@/storage/test/with-non-tiered-blob-provider";

test("tieredBlobToken: 503 before it ever looks for a token", async () => {
  await withNonTieredBlobProvider(async () => {
    const gate = tieredBlobToken(
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
