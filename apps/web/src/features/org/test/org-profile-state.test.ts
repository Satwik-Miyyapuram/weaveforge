/**
 * A failed read is not an answer (32-01, 32-08).
 *
 * Memberships that could not be read used to count as "no labs", and with no
 * labs a lab member's profile looks like one that needs the standalone sync,
 * which writes `active_org_id = null` on the server. A profile that could not
 * be read used to count as "no profile", which shows the first-run setup
 * screen to a user who already has a lab.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";
import type { Member, OrgMembershipView } from "@weaveforge/core";


const labMember = { id: "u1", email: "u@x", role: "phd", orgSetupComplete: true, activeOrgId: "o1" } as Member;
const lab = { orgId: "o1", role: "phd", joinSource: "invite" } as unknown as OrgMembershipView;

before(async () => {
  await loadTestCore();
});

test("unread memberships never trigger the standalone sync (32-01)", () => {
  assert.equal(readyCore().shouldSyncStandalone(labMember, null), false);
});

test("read memberships still decide as before", () => {
  // No labs and a lab role: the sync the domain asks for.
  assert.equal(readyCore().shouldSyncStandalone(labMember, []), true);
  // In the active lab: nothing to sync.
  assert.equal(readyCore().shouldSyncStandalone(labMember, [lab]), false);
  assert.equal(readyCore().shouldSyncStandalone(null, []), false);
});

const ready = { hasOrgs: true, loading: false, error: null };

test("a profile load error keeps the setup gate hidden (32-08)", () => {
  assert.equal(readyCore().needsOrgSetup({ ...ready, profile: null, error: "Network down" }), false);
});

test("no profile, or setup not complete, still shows the gate", () => {
  assert.equal(readyCore().needsOrgSetup({ ...ready, profile: null }), true);
  assert.equal(readyCore().needsOrgSetup({ ...ready, profile: { ...labMember, orgSetupComplete: false } }), true);
});

test("the gate is hidden while loading, without orgs, or once set up", () => {
  assert.equal(readyCore().needsOrgSetup({ ...ready, loading: true, profile: null }), false);
  assert.equal(readyCore().needsOrgSetup({ ...ready, hasOrgs: false, profile: null }), false);
  assert.equal(readyCore().needsOrgSetup({ ...ready, profile: labMember }), false);
});
