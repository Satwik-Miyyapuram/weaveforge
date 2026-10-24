import assert from "node:assert/strict";
import { test } from "node:test";

import { SupabaseAdminUserProvisioner } from "../admin-provisioner";

function provisionerWith(profile: { data: unknown; error: unknown }) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => profile }) }),
    }),
  };
  return new SupabaseAdminUserProvisioner("http://x", "key", () => client as never);
}

test("resolveCaller surfaces a profiles read error instead of reading it as no profile (09-09)", async () => {
  const p = provisionerWith({ data: null, error: { message: "profiles unavailable" } });
  await assert.rejects(p.resolveCaller("token"), /profiles unavailable/);
});

test("resolveCaller still returns null when the profile row is missing", async () => {
  const p = provisionerWith({ data: null, error: null });
  assert.equal(await p.resolveCaller("token"), null);
});

test("resolveCaller maps an existing profile", async () => {
  const p = provisionerWith({
    data: { user_id: "u1", email: "a@b.c", full_name: null, role: "student", supervisor_id: null },
    error: null,
  });
  assert.deepEqual(await p.resolveCaller("token"), {
    id: "u1",
    email: "a@b.c",
    fullName: undefined,
    role: "student",
    supervisorId: undefined,
  });
});
