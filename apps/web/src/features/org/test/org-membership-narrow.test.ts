/**
 * Server strings are narrowed, not cast (P2-210). A role or join source the
 * client does not know falls back to the least it can mean, and an error field
 * that is not a string is not read as one.
 */
import assert from "node:assert/strict";
import test, { before } from "node:test";

import { loadTestCore } from "@/lib/test/load-test-core";
import { orgResponse, toMembershipView } from "../infrastructure/parts";

before(async () => {
  await loadTestCore();
});

const view = (role: string, joinSource: string) => toMembershipView({ orgId: "o1", orgName: "Lab", role, joinSource });

test("known roles and sources pass through", () => {
  for (const role of ["professor", "phd", "masters"]) assert.equal(view(role, "invite").role, role);
  for (const source of ["legacy", "invite", "create"]) assert.equal(view("phd", source).joinSource, source);
});

test("an unknown role falls back to masters, the least privileged", () => {
  assert.equal(view("admin", "invite").role, "masters");
  assert.equal(view("", "invite").role, "masters");
});

test("an unknown join source falls back to legacy", () => {
  assert.equal(view("phd", "sso").joinSource, "legacy");
});

test("a non-string error field gives the fallback message", async () => {
  const res = new Response(JSON.stringify({ error: { code: 42 } }), { status: 400 });
  await assert.rejects(orgResponse(res, "Failed to join lab."), (err: Error) => {
    assert.match(err.message, /Failed to join lab\./);
    assert.doesNotMatch(err.message, /object Object/);
    return true;
  });
});