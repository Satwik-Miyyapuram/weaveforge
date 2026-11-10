import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { memberRowToDomain } from "../src/member-rows.js";
import type { ProfileRow } from "../src/bindings.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const row = {
  user_id: "u1",
  email: "a@example.org",
  full_name: "Ada",
  role: "professor",
  supervisor_id: null,
  org_setup_complete: true,
  active_org_id: "o1",
} as unknown as ProfileRow;

test("maps a profile row to a member with its id from user_id", () => {
  const member = memberRowToDomain(row);
  assert.equal(member.id, "u1");
  assert.equal(member.email, "a@example.org");
  assert.equal(member.fullName, "Ada");
  assert.equal(member.role, "professor");
  assert.equal(member.orgSetupComplete, true);
  assert.equal(member.activeOrgId, "o1");
});

test("null optional columns are read as absent and setup defaults to false", () => {
  const member = memberRowToDomain({
    ...row,
    email: null,
    full_name: null,
    supervisor_id: null,
    org_setup_complete: null,
    active_org_id: null,
  } as unknown as ProfileRow);
  assert.equal(member.orgSetupComplete, false);
  assert.equal(member.email, undefined);
  assert.equal(member.fullName, undefined);
  assert.equal(member.supervisorId, undefined);
  assert.equal(member.activeOrgId, undefined);
});
