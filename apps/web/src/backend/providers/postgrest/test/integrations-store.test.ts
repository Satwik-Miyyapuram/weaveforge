import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadTestCore } from "@/lib/test/load-test-core";

import { rustIntegrationsStore } from "../wire-postgrest-backend";

before(loadTestCore);

// A database that is down: every call throws. The sync integration store must
// surface the failure to the caller rather than report a save that never happened.
const throwingDb = {
  from: () => {
    throw new Error("db down");
  },
  rpc: () => {
    throw new Error("db down");
  },
} as unknown as SupabaseClient;

const integration = { provider: "github" as const, enabled: true, token: "SECRET-gh", branch: "main" };

test("a throwing database makes integration save reject", async () => {
  await assert.rejects(rustIntegrationsStore(throwingDb).save("p1", integration), /db down/);
});

test("a throwing database makes integration get reject", async () => {
  await assert.rejects(rustIntegrationsStore(throwingDb).get("p1", "github"), /db down/);
});
