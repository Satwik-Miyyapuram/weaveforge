import assert from "node:assert/strict";
import { test } from "node:test";

import { SharingFacade } from "../sharing";

const withoutLinks = () =>
  new SharingFacade({
    createShareLink: null,
    redeemShareLink: null,
    manageShareLinks: null,
    revokeShareLink: null,
    session: { requireUserId: async () => "u1" },
  } as never);

test("share-link calls without the PostgREST backend fail with one clear message (10-32)", async () => {
  const f = withoutLinks();
  assert.equal(f.shareLinksEnabled(), false);
  const msg = /Share links require the PostgREST backend\./;
  await assert.rejects(f.createShareLink({ resourceType: "paper", resourceId: "p" }), msg);
  await assert.rejects(f.redeemShareLink("tok"), msg);
  await assert.rejects(f.revokeShareLink({ id: "l" }), msg);
  assert.deepEqual(await f.listShareLinks("paper", "p"), []);
});

test("share-link calls reach the use case when it is wired (10-32)", async () => {
  const calls: string[] = [];
  const f = new SharingFacade({
    createShareLink: { execute: async (i: unknown) => (calls.push(`create ${JSON.stringify(i)}`), "c") },
    redeemShareLink: { execute: async (t: string) => (calls.push(`redeem ${t}`), "r") },
    manageShareLinks: null,
    revokeShareLink: { execute: async (i: unknown) => (calls.push(`revoke ${JSON.stringify(i)}`), "v") },
    session: { requireUserId: async () => "u1" },
  } as never);
  assert.equal(await f.createShareLink({ resourceType: "paper", resourceId: "p" }), "c");
  assert.equal(await f.redeemShareLink("tok"), "r");
  assert.equal(await f.revokeShareLink({ id: "l" }), "v");
  assert.deepEqual(calls, [
    'create {"ownerId":"u1","resourceType":"paper","resourceId":"p"}',
    "redeem tok",
    'revoke {"ownerId":"u1","linkId":"l"}',
  ]);
});
