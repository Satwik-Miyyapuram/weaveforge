import { test } from "node:test";
import assert from "node:assert/strict";
import { OrgInviteValidationError, OrgValidationError } from "@weaveforge/core";
import { orgApiErrorResponse, requireOrgApiUser } from "../_shared";
test("orgApiErrorResponse: maps validation errors to 400", async () => {
  for (const err of [new OrgInviteValidationError("bad code"), new OrgValidationError("bad name")]) {
    const res = orgApiErrorResponse(err);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, err.message);
  }
});

test("orgApiErrorResponse: maps unknown errors to 500", async () => {
  const res = orgApiErrorResponse(new Error("db exploded"));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, "db exploded");
});

test("requireOrgApiUser: 401 when no token, before any Supabase call", async () => {
  const auth = await requireOrgApiUser(new Request("http://localhost/api/org/mine"));
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.response.status, 401);
    assert.match((await auth.response.json()).error, /Not authenticated/);
  }
});
