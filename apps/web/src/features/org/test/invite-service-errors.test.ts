/**
 * A database error in an org read is a server error (500), never dressed up as
 * "invalid code", "not the owner" or an empty answer (32-07, 32-19..32-23).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { httpStatusForError } from "@weaveforge/core";

import { OrgInviteService } from "../infrastructure/org-invite-service";

type Answer = { data?: unknown; error: unknown };
const OK = (data: unknown): Answer => ({ data, error: null });
const DB_DOWN = { message: "connection reset", code: "08006" };
const FAIL: Answer = { data: null, error: DB_DOWN };

/**
 * A query chain that answers each table from a queue, one answer per awaited
 * query, in call order. An exhausted queue answers `{ data: null }`.
 */
function scripted(answers: Record<string, Answer[]>, rpc: Answer = OK(null)) {
  const next = (table: string): Answer => answers[table]?.shift() ?? OK(null);
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const settle = async () => next(table);
    Object.assign(chain, {
      select: self, eq: self, is: self, in: self, order: self, limit: self,
      update: self, delete: self, upsert: self,
      single: settle,
      maybeSingle: settle,
      then: (ok: (v: Answer) => unknown, fail?: (e: unknown) => unknown) => settle().then(ok, fail),
    });
    return chain;
  };
  return {
    from,
    rpc: async () => rpc,
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: "a@b.c" } }, error: null }) } },
  };
}

function service(admin: unknown) {
  const svc = new OrgInviteService("http://localhost", "key");
  (svc as unknown as { admin: () => unknown }).admin = () => admin;
  return svc;
}

const CODE = { id: "c1", org_id: "o1", target_role: "phd", code_hash: "h", revoked_at: null };
const ORG = { id: "o1", name: "Lab", owner_id: "owner", created_at: "2026-01-01" };

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (err) {
    return httpStatusForError(err);
  }
  assert.fail("expected a rejection");
}

test("join: an RPC error other than a dead code is a 500 (32-21)", async () => {
  const admin = scripted(
    { org_invite_codes: [OK(CODE)], organizations: [OK(ORG)] },
    { data: null, error: { message: "deadlock detected" } },
  );
  assert.equal(await statusOf(service(admin).joinOrganization("u1", { code: "ABCDE-FGHJK" })), 500);
});

test("join: a code revoked mid-join stays a 400", async () => {
  const admin = scripted(
    { org_invite_codes: [OK(CODE)], organizations: [OK(ORG)] },
    { data: null, error: { message: "invite code is no longer valid" } },
  );
  assert.equal(await statusOf(service(admin).joinOrganization("u1", { code: "ABCDE-FGHJK" })), 400);
});

test("join: a failed membership read is a 500, not a join (32-20)", async () => {
  const admin = scripted({ org_invite_codes: [OK(CODE)], organizations: [OK(ORG)], org_memberships: [FAIL] });
  assert.equal(await statusOf(service(admin).joinOrganization("u1", { code: "ABCDE-FGHJK" })), 500);
});

test("join: a failed role lookup is a 500, not an empty lab (32-07)", async () => {
  const admin = scripted({ org_invite_codes: [OK(CODE)], organizations: [OK(ORG)], org_memberships: [OK(null), FAIL] });
  assert.equal(await statusOf(service(admin).joinOrganization("u1", { code: "ABCDE-FGHJK" })), 500);
});

test("preview: a failed code read is a 500, not an invalid code (32-22)", async () => {
  const admin = scripted({ org_invite_codes: [FAIL] });
  assert.equal(await statusOf(service(admin).previewCode("ABCDE-FGHJK")), 500);
});

test("preview: a failed lab read is a 500", async () => {
  const admin = scripted({ org_invite_codes: [OK(CODE)], organizations: [FAIL] });
  assert.equal(await statusOf(service(admin).previewCode("ABCDE-FGHJK")), 500);
});

test("preview: a failed name read is a 500", async () => {
  const admin = scripted({
    org_invite_codes: [OK({ org_id: "o1", target_role: "phd" })],
    organizations: [OK({ name: "Lab" })],
    org_memberships: [OK([{ user_id: "p1" }, { user_id: "p2" }]), OK([])],
    profiles: [FAIL],
  });
  assert.equal(await statusOf(service(admin).previewCode("ABCDE-FGHJK")), 500);
});

test("preview: an unknown code is still null", async () => {
  const admin = scripted({ org_invite_codes: [OK(null)] });
  assert.equal(await service(admin).previewCode("ABCDE-FGHJK"), null);
});

test("preview: a lab with two professors names them", async () => {
  const admin = scripted({
    org_invite_codes: [OK({ org_id: "o1", target_role: "phd" })],
    organizations: [OK({ name: "Lab" })],
    org_memberships: [OK([{ user_id: "p1" }, { user_id: "p2" }]), OK([])],
    profiles: [OK([{ user_id: "p1", full_name: "Ada", email: null }, { user_id: "p2", full_name: null, email: "b@x" }])],
  });
  const out = await service(admin).previewCode("ABCDE-FGHJK");
  assert.deepEqual(out?.professors, [{ id: "p1", label: "Ada" }, { id: "p2", label: "b@x" }]);
});

test("regenerate: a failed owner read is a 500, not a permission error (32-19)", async () => {
  const admin = scripted({ organizations: [FAIL] });
  assert.equal(await statusOf(service(admin).regenerateCode("u1", "o1", "phd")), 500);
});

test("leave: a failed profile read is a 500 (32-23)", async () => {
  const admin = scripted({
    organizations: [OK({ owner_id: "owner" })],
    org_memberships: [OK({ role: "phd", supervisor_id: null }), OK(null)],
    profiles: [OK(null), FAIL],
  });
  assert.equal(await statusOf(service(admin).leaveOrganization("u1", "o1")), 500);
});

test("leave: a failed next-membership read is a 500, not standalone", async () => {
  const admin = scripted({
    organizations: [OK({ owner_id: "owner" })],
    org_memberships: [OK({ role: "phd", supervisor_id: null }), OK(null), FAIL],
    profiles: [OK(null), OK({ active_org_id: "o1" })],
  });
  assert.equal(await statusOf(service(admin).leaveOrganization("u1", "o1")), 500);
});
