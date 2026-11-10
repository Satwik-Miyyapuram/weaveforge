import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("membershipViewFromRow: reads the embedded org whether object or array", () => {
  const row = { org_id: "o1", role: "member", joined_via: "invite" };
  assert.equal(readyCore().membershipViewFromRow({ ...row, organizations: { name: "Lab A" } }).orgName, "Lab A");
  assert.equal(readyCore().membershipViewFromRow({ ...row, organizations: [{ name: "Lab A" }] }).orgName, "Lab A");
  assert.equal(readyCore().membershipViewFromRow({ ...row, organizations: null }).orgName, "Lab");
});

test("membershipViewFromRow: a row written before joined_via existed reads as legacy", () => {
  assert.equal(readyCore().membershipViewFromRow({ org_id: "o1", role: "owner" }).joinSource, "legacy");
  assert.equal(readyCore().membershipViewFromRow({ org_id: "o1", role: "owner", joined_via: "create" }).joinSource, "create");
});
