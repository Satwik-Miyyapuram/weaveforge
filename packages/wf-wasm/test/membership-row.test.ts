import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { membershipViewFromRow } from "../src/wrappers-4.js";
import type { MembershipRow } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const base = { org_id: "o1", role: "phd", joined_via: "invite" };

test("reads the embedded org name whether the embed is an object or an array", () => {
  const object = membershipViewFromRow({ ...base, organizations: { name: "Lab A" } } as MembershipRow);
  const array = membershipViewFromRow({ ...base, organizations: [{ name: "Lab A" }] } as MembershipRow);
  assert.equal(object.orgName, "Lab A");
  assert.equal(array.orgName, "Lab A");
});

test("a null or missing embed falls back to the name Lab", () => {
  assert.equal(membershipViewFromRow({ ...base, organizations: null } as MembershipRow).orgName, "Lab");
  assert.equal(membershipViewFromRow({ ...base } as MembershipRow).orgName, "Lab");
});

test("a row written before joined_via existed reads as legacy", () => {
  const view = membershipViewFromRow({ org_id: "o1", role: "professor" } as MembershipRow);
  assert.equal(view.joinSource, "legacy");
  assert.equal(membershipViewFromRow({ ...base, joined_via: "create" } as MembershipRow).joinSource, "create");
});

test("the row maps to the camelCase view with the stored role", () => {
  const view = membershipViewFromRow({ ...base, organizations: { name: "Lab A" } } as MembershipRow);
  assert.deepEqual(view, { orgId: "o1", orgName: "Lab A", role: "phd", joinSource: "invite" });
});
