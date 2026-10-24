/**
 * A failed credentials read is an error, not "no keys" (31-01).
 *
 * The route answers 500 when it cannot read or decrypt the sealed credentials.
 * Read as `{}`, the screen showed no keys, and the next save sealed that empty
 * set over every stored credential. `save()` also re-read the secrets it was
 * about to overwrite, an extra round trip that would now fail the save (31-15).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import {
  PostgrestSettingsRepository,
  RouteSecretsStore,
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/postgrest-settings-repository";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function client(): SupabaseClient {
  return {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  } as unknown as SupabaseClient;
}

function answer(status: number, body: unknown) {
  const calls: Array<{ method: string }> = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET" });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("the route store returns the secrets the route sends", async () => {
  answer(200, { zoteroApiKey: "k" });
  assert.deepEqual(await new RouteSecretsStore(client()).load(), { zoteroApiKey: "k" });
});

test("a 500 from the credentials route rejects with the route's error (31-01)", async () => {
  answer(500, { error: "Credentials could not be decrypted." });
  await assert.rejects(new RouteSecretsStore(client()).load(), /Credentials could not be decrypted/);
});

test("a non-OK answer with no JSON body still rejects (31-01)", async () => {
  globalThis.fetch = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
  await assert.rejects(new RouteSecretsStore(client()).load(), /credentials/i);
});

test("a 401 rejects too, rather than reading as no keys (31-01)", async () => {
  answer(401, { error: "Unauthorized" });
  await assert.rejects(new RouteSecretsStore(client()).load(), /Unauthorized/);
});

/** A user_settings row, and a secrets store that counts its calls. */
let uid = 0;
function repoWith(secrets: Partial<SecretsStore>) {
  const counts = { load: 0, save: 0 };
  const saved: Secrets[] = [];
  const upserts: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({
          data: { zotero_library: "lib", disclaimer_accepted_at: "2026-01-01", disclaimer_version: 3, appearance: null, ai_access: null },
          error: null,
        }),
      }),
      upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { data: null, error: null }; },
    }),
  } as unknown as SupabaseClient;
  // A fresh user per repo, so the module-level memo never answers across tests.
  const user = `user-${(uid += 1)}`;
  const session: ICurrentUserProvider = { getCurrentUserId: async () => user, requireUserId: async () => user };
  const store: SecretsStore = {
    load: async () => { counts.load += 1; return secrets.load ? secrets.load() : {}; },
    save: async (s) => { counts.save += 1; saved.push(s); },
  };
  return { repo: new PostgrestSettingsRepository(db, session, store), counts, saved, upserts };
}

test("get() rejects when the secrets cannot be read (31-01)", async () => {
  const { repo } = repoWith({ load: async () => { throw new Error("credentials 500"); } });
  await assert.rejects(repo.get(), /credentials 500/);
});

test("a failed get() is not remembered: the next one reads again", async () => {
  let fail = true;
  const { repo } = repoWith({ load: async () => { if (fail) throw new Error("down"); return { zoteroApiKey: "k" }; } });
  await assert.rejects(repo.get());
  fail = false;
  assert.equal((await repo.get()).zoteroApiKey, "k");
});

test("save() does not read the secrets it is about to replace (31-15)", async () => {
  const { repo, counts, saved } = repoWith({});
  await repo.save({ zoteroApiKey: "new", zoteroLibrary: "lib" });
  assert.equal(counts.load, 0);
  assert.equal(counts.save, 1);
  assert.equal(saved[0]!.zoteroApiKey, "new");
});

test("save() succeeds while the secrets read is failing, and seals what it was given (31-15)", async () => {
  const { repo, saved } = repoWith({ load: async () => { throw new Error("down"); } });
  await repo.save({ semanticScholarKey: "s" });
  assert.equal(saved[0]!.semanticScholarKey, "s");
});

test("save() still keeps the stored disclaimer when the caller leaves it out", async () => {
  const { repo, upserts } = repoWith({});
  await repo.save({ zoteroLibrary: "lib" });
  assert.equal(upserts[0]!.disclaimer_accepted_at, "2026-01-01");
  assert.equal(upserts[0]!.disclaimer_version, 3);
});
