import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatInviteCode,
  normalizeOrgInviteCode,
  resolveOrgJoinAssignment,
  OrgInviteValidationError,
} from "../../../src/features/org/domain/invite-code.js";
import {
  generateOrgInviteCode,
  hashOrgInviteCode,
  hashOrgInviteCodeInput,
} from "../../../src/features/org/domain/invite-code-crypto.js";

test("normalizeOrgInviteCode strips hyphens and fixes typos", () => {
  assert.equal(normalizeOrgInviteCode("abc-def-gh2"), "ABCDEFGH2");
  assert.equal(normalizeOrgInviteCode("oilo"), "0110");
});

test("generateOrgInviteCode returns grouped code", () => {
  const code = generateOrgInviteCode();
  assert.match(code, /^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{3}$/);
});

test("hashOrgInviteCodeInput is stable", () => {
  const a = hashOrgInviteCodeInput("K7M-4NP-R2X");
  const b = hashOrgInviteCodeInput("k7m4npr2x");
  assert.equal(a, b);
});

test("resolveOrgJoinAssignment assigns phd to sole professor", () => {
  const r = resolveOrgJoinAssignment(
    {
      targetRole: "phd",
      orgOwnerId: "owner",
      professorIds: ["owner"],
      phdIds: [],
    },
    { code: "K7M-4NP-R2X" },
  );
  assert.equal(r.role, "phd");
  assert.equal(r.supervisorId, "owner");
});

test("resolveOrgJoinAssignment requires phd picker for masters", () => {
  assert.throws(
    () =>
      resolveOrgJoinAssignment(
        {
          targetRole: "masters",
          orgOwnerId: "owner",
          professorIds: ["owner"],
          phdIds: ["phd1"],
        },
        { code: "K7M-4NP-R2X" },
      ),
    OrgInviteValidationError,
  );
});

test("resolveOrgJoinAssignment professor join has no supervisor", () => {
  const r = resolveOrgJoinAssignment(
    {
      targetRole: "professor",
      orgOwnerId: "owner",
      professorIds: ["owner"],
      phdIds: [],
    },
    { code: "X" },
  );
  assert.equal(r.role, "professor");
  assert.equal(r.supervisorId, undefined);
});
