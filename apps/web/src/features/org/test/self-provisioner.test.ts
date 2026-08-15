import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SupabaseSelfProvisioner,
  resetSelfProvisioningMemoForTests,
} from "../infrastructure/supabase-self-provisioner";

function stubClient(opts: { userId?: string | null; error?: unknown } = {}) {
  const calls: string[] = [];
  const db = {
    auth: {
      getSession: async () => ({
        data: { session: opts.userId === null ? null : { user: { id: opts.userId ?? "user-1" } } },
      }),
    },
    rpc: async (name: string) => {
      calls.push(name);
      return { data: null, error: opts.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("SupabaseSelfProvisioner", () => {
  beforeEach(() => resetSelfProvisioningMemoForTests());

  it("provisions the caller with an RPC that takes no arguments", async () => {
    const { db, calls } = stubClient();
    await new SupabaseSelfProvisioner(db).ensureProvisioned();
    assert.deepEqual(calls, ["ensure_user_provisioned"]);
  });

  it("does not repeat the round trip once a user is provisioned", async () => {
    const { db, calls } = stubClient();
    const provisioner = new SupabaseSelfProvisioner(db);
    await provisioner.ensureProvisioned();
    await provisioner.ensureProvisioned();
    // A second instance shares the memo — startup builds one per container.
    await new SupabaseSelfProvisioner(db).ensureProvisioned();
    assert.equal(calls.length, 1);
  });

  it("does nothing without a session", async () => {
    const { db, calls } = stubClient({ userId: null });
    await new SupabaseSelfProvisioner(db).ensureProvisioned();
    assert.deepEqual(calls, []);
  });

  it("reports the database's own message, never [object Object]", async () => {
    const { db } = stubClient({ error: { message: "permission denied for function" } });
    await assert.rejects(
      () => new SupabaseSelfProvisioner(db).ensureProvisioned(),
      /permission denied for function/,
    );
  });

  it("does not remember a failure as success", async () => {
    const { db, calls } = stubClient({ error: { message: "network" } });
    const provisioner = new SupabaseSelfProvisioner(db);
    await provisioner.ensureProvisioned().catch(() => undefined);
    await provisioner.ensureProvisioned().catch(() => undefined);
    assert.equal(calls.length, 2);
  });
});
