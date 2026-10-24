/**
 * One list of lab roles (03-12) and the lab pool a viewer sees (03-13).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ORG_INVITE_ROLES } from "../../../src/features/org/domain/invite-code.js";
import { filterTeamMembers, ROLE_RANK, ROLES, type Member } from "../../../src/features/org/domain/member.js";

test("the invite roles are the member roles, one list (03-12)", () => {
  assert.equal(ROLES, ORG_INVITE_ROLES);
  for (const role of ROLES) assert.ok(ROLE_RANK[role] >= 0, role);
  assert.ok(!(ROLES as readonly string[]).includes("standalone"));
});

const member = (id: string, role: Member["role"], supervisorId?: string): Member => ({ id, role, supervisorId }) as Member;
const all = [member("prof", "professor"), member("me", "phd", "prof"), member("stu", "masters", "me"), member("other", "masters")];

test("outside a lab the viewer sees only themselves (03-13)", () => {
  assert.deepEqual(filterTeamMembers("me", all, { inLab: false }).map((m) => m.id), ["me"]);
});

test("in a lab with unknown membership the pool fails closed to the viewer", () => {
  assert.deepEqual(filterTeamMembers("me", all, { inLab: true, orgMemberIds: null }).map((m) => m.id), ["me"]);
  assert.deepEqual(filterTeamMembers("me", all, { inLab: true, orgMemberIds: new Set() }).map((m) => m.id), ["me"]);
});

test("a viewer missing from the members list sees nobody", () => {
  assert.deepEqual(filterTeamMembers("ghost", all, { inLab: false }), []);
});

test("in a lab the pool is the lab, then the viewer's subtree", () => {
  const ids = filterTeamMembers("me", all, { inLab: true, orgMemberIds: new Set(["prof", "me", "stu"]) }).map((m) => m.id);
  assert.deepEqual(ids.sort(), ["me", "stu"]);
});
