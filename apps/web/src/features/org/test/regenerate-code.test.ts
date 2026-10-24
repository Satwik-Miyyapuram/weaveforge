/**
 * Regenerating a code revokes the old one first; if the revoke fails, no new
 * code is made and the old one is not left silently valid (32-02).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { OrgInviteService } from "../infrastructure/org-invite-service";

type Answer = { data?: unknown; error: unknown };

/** A query chain that records writes and answers each table once awaited. */
function fakeAdmin(answers: { owner?: string; revokeError?: unknown; insertError?: unknown }) {
  const writes: { table: string; op: string }[] = [];
  const from = (table: string) => {
    let result: Answer = { data: null, error: null };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self,
      eq: self,
      is: self,
      single: async () => (table === "organizations"
        ? { data: answers.owner ? { owner_id: answers.owner } : null, error: null }
        : result),
      update: () => { writes.push({ table, op: "update" }); result = { error: answers.revokeError ?? null }; return chain; },
      insert: async () => { writes.push({ table, op: "insert" }); return { error: answers.insertError ?? null }; },
      then: (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail),
    });
    return chain;
  };
  return { admin: { from }, writes };
}

function service(admin: unknown) {
  const svc = new OrgInviteService("http://localhost", "key");
  (svc as unknown as { admin: () => unknown }).admin = () => admin;
  return svc;
}

test("a failed revoke rejects and inserts no new code (32-02)", async () => {
  const revokeError = { message: "revoke failed" };
  const { admin, writes } = fakeAdmin({ owner: "u1", revokeError });
  await assert.rejects(service(admin).regenerateCode("u1", "o1", "phd"), (err) => err === revokeError);
  assert.deepEqual(writes, [{ table: "org_invite_codes", op: "update" }]);
});

test("a successful revoke is followed by one new code", async () => {
  const { admin, writes } = fakeAdmin({ owner: "u1" });
  const out = await service(admin).regenerateCode("u1", "o1", "phd");
  assert.equal(out.targetRole, "phd");
  assert.equal(typeof out.code, "string");
  assert.deepEqual(writes.map((w) => w.op), ["update", "insert"]);
});

test("someone other than the owner changes nothing", async () => {
  const { admin, writes } = fakeAdmin({ owner: "someone-else" });
  await assert.rejects(service(admin).regenerateCode("u1", "o1", "phd"), /owner/);
  assert.deepEqual(writes, []);
});
