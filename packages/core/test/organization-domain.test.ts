import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasActiveLab,
  isExplicitLabMembership,
  type OrgMembershipView,
} from "../src/features/org/domain/organization.js";

const legacyMembership = (orgId: string): OrgMembershipView => ({
  orgId,
  orgName: "Legacy Lab",
  role: "masters",
  joinSource: "legacy",
});

const inviteMembership = (orgId: string): OrgMembershipView => ({
  orgId,
  orgName: "Joined Lab",
  role: "masters",
  joinSource: "invite",
});

describe("isExplicitLabMembership", () => {
  it("treats legacy backfill as implicit", () => {
    assert.equal(isExplicitLabMembership(legacyMembership("org-1")), false);
  });

  it("treats invite and create as explicit", () => {
    assert.equal(isExplicitLabMembership(inviteMembership("org-1")), true);
    assert.equal(
      isExplicitLabMembership({ ...inviteMembership("org-1"), joinSource: "create" }),
      true,
    );
  });
});

describe("hasActiveLab", () => {
  it("returns false without active org", () => {
    assert.equal(hasActiveLab(null, [inviteMembership("org-1")]), false);
  });

  it("returns false for legacy-only membership even when active org is set", () => {
    assert.equal(hasActiveLab("org-1", [legacyMembership("org-1")]), false);
  });

  it("returns true for explicit membership on the active org", () => {
    assert.equal(hasActiveLab("org-1", [inviteMembership("org-1")]), true);
  });

  it("returns true when the user owns the active org", () => {
    assert.equal(hasActiveLab("org-1", [legacyMembership("org-1")], true), true);
  });
});
