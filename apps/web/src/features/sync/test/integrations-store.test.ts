import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PostgrestIntegrationsStore } from "../infrastructure/postgrest-integrations-store";
import { mattermostConnectionReady } from "../domain/integration-fields";
import type { Integration } from "../domain/integration";

/**
 * A blank Mattermost channel stays blank (33-11).
 *
 * `branch` holds a git branch for the git providers and a channel id for
 * Mattermost. Saving filled a blank one with "main", which made a half-set
 * Mattermost connection look complete and sent posts to a channel id "main".
 * Rows saved that way are read back as unset: a Mattermost channel id is a
 * 26-character id, never "main".
 */

/** A client that keeps what was upserted and answers a read with `row`. */
function fakeDb(row: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
    upsert: async (r: Record<string, unknown>) => {
      saved.push(r);
      return { error: null };
    },
  };
  const db = { from: () => query } as unknown as SupabaseClient;
  return { store: new PostgrestIntegrationsStore(db), saved };
}

const mattermost: Integration = {
  provider: "mattermost",
  enabled: true,
  token: "bot",
  repo: "https://chat.example.com",
  branch: "",
};

test("a blank Mattermost channel is saved blank", async () => {
  const { store, saved } = fakeDb();
  await store.save("p1", mattermost);
  assert.equal(saved[0]!.branch, "");
});

test("a set Mattermost channel is saved as is", async () => {
  const { store, saved } = fakeDb();
  await store.save("p1", { ...mattermost, branch: "x8k3j2" });
  assert.equal(saved[0]!.branch, "x8k3j2");
});

test("a blank git branch still defaults to main", async () => {
  for (const provider of ["github", "gitlab"] as const) {
    const { store, saved } = fakeDb();
    await store.save("p1", { provider, enabled: true, token: "t", repo: "o/r", branch: "" });
    assert.equal(saved[0]!.branch, "main", provider);
  }
});

test("a Mattermost row saved as \"main\" reads back unset and not ready", async () => {
  const { store } = fakeDb({
    provider: "mattermost",
    enabled: true,
    token: "bot",
    repo: "https://chat.example.com",
    branch: "main",
    options: null,
  });
  const read = await store.get("p1", "mattermost");
  assert.equal(read.branch, "");
  assert.equal(mattermostConnectionReady(read), false);
});

test("a Mattermost row with no channel reads back blank", async () => {
  const { store } = fakeDb({ provider: "mattermost", enabled: true, token: "bot", repo: "u", branch: null, options: null });
  assert.equal((await store.get("p1", "mattermost")).branch, "");
});

test("a git row keeps its branch, and a missing one reads as main", async () => {
  const kept = fakeDb({ provider: "github", enabled: true, token: "t", repo: "o/r", branch: "main", options: null });
  assert.equal((await kept.store.get("p1", "github")).branch, "main");
  const missing = fakeDb({ provider: "github", enabled: true, token: "t", repo: "o/r", branch: null, options: null });
  assert.equal((await missing.store.get("p1", "github")).branch, "main");
});
