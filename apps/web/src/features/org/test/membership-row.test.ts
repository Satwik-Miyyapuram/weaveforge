import { test } from "node:test";
import assert from "node:assert/strict";
import { membershipViewFromRow } from "../infrastructure/membership-row";

test("membershipViewFromRow: reads the embedded org whether object or array", () => {
  const row = { org_id: "o1", role: "member", joined_via: "invite" };
  assert.equal(membershipViewFromRow({ ...row, organizations: { name: "Lab A" } }).orgName, "Lab A");
  assert.equal(membershipViewFromRow({ ...row, organizations: [{ name: "Lab A" }] }).orgName, "Lab A");
  assert.equal(membershipViewFromRow({ ...row, organizations: null }).orgName, "Lab");
});

test("membershipViewFromRow: a row written before joined_via existed reads as legacy", () => {
  assert.equal(membershipViewFromRow({ org_id: "o1", role: "owner" }).joinSource, "legacy");
  assert.equal(membershipViewFromRow({ org_id: "o1", role: "owner", joined_via: "create" }).joinSource, "create");
});
