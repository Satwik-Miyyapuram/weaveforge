/**
 * The settings memo belongs to the account that read it.
 *
 * Settings (with decrypted integration keys) and the metadata row were memoised
 * at module level for a minute, whoever was signed in. Sign out, sign in as
 * someone else inside that minute, and the second account was handed the
 * first account's settings, API keys included.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ICurrentUserProvider } from "@weaveforge/core";
import {
  PostgrestSettingsRepository,
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/postgrest-settings-repository";

/** One signed-in user at a time; the row and secrets the server holds for them. */
function world() {
  let current: string | null = "user-a";
  const pending: Array<() => void> = [];
  let hold = false;
  const answer = <T>(value: T): Promise<T> =>
    hold ? new Promise((ok) => pending.push(() => ok(value))) : Promise.resolve(value);

  const db = {
    from: () => ({
      select: () => ({
        maybeSingle: () => {
          const uid = current;
          return answer({
            data: uid
              ? { user_id: uid, zotero_library: `lib-${uid}`, disclaimer_accepted_at: null, disclaimer_version: uid === "user-a" ? 1 : 2, appearance: null, ai_access: null }
              : null,
            error: null,
          });
        },
      }),
    }),
  } as unknown as SupabaseClient;
  const session: ICurrentUserProvider = {
    getCurrentUserId: async () => current,
    requireUserId: async () => {
      if (!current) throw new Error("signed out");
      return current;
    },
  };
  const secrets: SecretsStore = {
    load: async (): Promise<Secrets> => ({ zoteroApiKey: current ? `key-${current}` : undefined }),
    save: async () => {},
  };
  return {
    repo: () => new PostgrestSettingsRepository(db, session, secrets),
    signInAs: (uid: string | null) => {
      current = uid;
    },
    holdReads: () => {
      hold = true;
    },
    releaseReads: () => {
      hold = false;
      for (const go of pending.splice(0)) go();
    },
  };
}

test("settings memo: another account signing in does not get the first account's settings", async () => {
  const w = world();
  assert.equal((await w.repo().get()).zoteroApiKey, "key-user-a");
  w.signInAs(null);
  w.signInAs("user-b");
  const b = await w.repo().get();
  assert.equal(b.zoteroApiKey, "key-user-b");
  assert.equal(b.zoteroLibrary, "lib-user-b");
});

test("settings memo: the metadata row is not shared across accounts either", async () => {
  const w = world();
  assert.equal((await w.repo().getMetadata()).disclaimerVersion, 1);
  w.signInAs("user-b");
  assert.equal((await w.repo().getMetadata()).disclaimerVersion, 2);
});

test("settings memo: signed out, nothing of the last account is served", async () => {
  const w = world();
  await w.repo().get();
  w.signInAs(null);
  assert.equal((await w.repo().get()).zoteroApiKey, undefined);
});

test("settings memo: a read started by one account is not handed to the next", async () => {
  const w = world();
  w.holdReads();
  const a = w.repo().get();
  await new Promise((ok) => setImmediate(ok));
  w.signInAs("user-b");
  const b = w.repo().get();
  w.releaseReads();
  assert.equal((await b).zoteroLibrary, "lib-user-b");
  await a;
});

test("settings memo: the same account still shares one read", async () => {
  const w = world();
  w.signInAs("user-c"); // the memo is module-wide; a user no earlier test read as
  let reads = 0;
  const repo = w.repo();
  const original = repo["readSettings"].bind(repo);
  (repo as unknown as { readSettings: () => Promise<unknown> }).readSettings = () => {
    reads += 1;
    return original();
  };
  await Promise.all([repo.get(), repo.get()]);
  await repo.get();
  assert.equal(reads, 1);
});
