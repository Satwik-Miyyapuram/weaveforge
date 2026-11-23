import assert from "node:assert/strict";
import { before, test } from "node:test";

import { OrgFacade } from "../org";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

function facade(calls: unknown[]) {
  return new OrgFacade({
    members: { assertCanCreate: async (role: string) => void calls.push(`gate ${role}`) },
    provisioner: {
      createMember: async (input: unknown) => {
        calls.push(input);
        return { id: "new", email: "n@example.com", role: "masters" };
      },
    },
  } as never);
}

test("createMember needs no password: the member is invited by email (0.9.8)", async () => {
  const calls: unknown[] = [];
  const stray = { email: "n@example.com", fullName: "N", role: "masters", password: "password1" };
  await facade(calls).createMember(stray as never);
  assert.equal(calls[0], "gate masters");
  const sent = calls[1] as Record<string, unknown>;
  assert.equal(sent.email, "n@example.com");
  assert.equal(sent.role, "masters");
  assert.equal("password" in sent, false, "no password reaches the provisioner");
});

test("createMember still refuses an empty email before the gate", async () => {
  const calls: unknown[] = [];
  await assert.rejects(facade(calls).createMember({ email: "", role: "masters" }), /Email is required\./);
  assert.deepEqual(calls, []);
});