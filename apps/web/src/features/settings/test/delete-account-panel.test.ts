/**
 * After the server deleted the account the session is already gone, so
 * `signOut()` can throw. That must not show "deletion failed" or keep the user
 * on a page for an account that no longer exists (P2-238).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { leaveDeletedAccount } from "../ui/delete-account-panel";

test("a sign-out that throws after a delete still leaves the page (P2-238)", async () => {
  const went: string[] = [];
  await leaveDeletedAccount(async () => { throw new Error("session missing"); }, (to) => went.push(to));
  assert.deepEqual(went, ["/"]);
});

test("a sign-out that works leaves the page once", async () => {
  const went: string[] = [];
  let signedOut = 0;
  await leaveDeletedAccount(async () => { signedOut += 1; }, (to) => went.push(to));
  assert.equal(signedOut, 1);
  assert.deepEqual(went, ["/"]);
});
