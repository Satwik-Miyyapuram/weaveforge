/**
 * Every repository asks this provider for the signed-in user id. A lookup
 * that started before an account switch must not answer for the new account
 * (09-03), and a provider whose container is gone must stop listening (09-10).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseSessionProvider } from "../providers/supabase-auth/session";

type UserResult = { data: { user: { id: string } | null }; error: Error | null };

function fakeClient() {
  const listeners = new Set<() => void>();
  const lookups: Array<(id: string | null) => void> = [];
  const client = {
    auth: {
      onAuthStateChange(cb: () => void) {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => void listeners.delete(cb) } } };
      },
      getUser(): Promise<UserResult> {
        return new Promise((resolve) => {
          lookups.push((id) => resolve({ data: { user: id ? { id } : null }, error: null }));
        });
      },
    },
  };
  return {
    db: client as unknown as SupabaseClient,
    listeners,
    lookups,
    authChanged: () => {
      for (const cb of listeners) cb();
    },
  };
}

test("concurrent lookups share one getUser call", async () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  const a = session.getCurrentUserId();
  const b = session.getCurrentUserId();
  assert.equal(fake.lookups.length, 1);
  fake.lookups[0]!("u1");
  assert.equal(await a, "u1");
  assert.equal(await b, "u1");
  assert.equal(await session.getCurrentUserId(), "u1");
  assert.equal(fake.lookups.length, 1, "the answer is cached");
});

test("a lookup from before an account switch does not answer for the new account (09-03)", async () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  const stale = session.getCurrentUserId();

  fake.authChanged();
  const fresh = session.getCurrentUserId();
  assert.equal(fake.lookups.length, 2, "the switch starts a new lookup");

  fake.lookups[0]!("old-user");
  await stale;
  fake.lookups[1]!("new-user");
  assert.equal(await fresh, "new-user");

  assert.equal(await session.requireUserId(), "new-user");
  assert.equal(fake.lookups.length, 2);
});

test("a stale lookup that settles does not drop the newer one in flight (09-03)", async () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  const stale = session.getCurrentUserId();
  fake.authChanged();
  const fresh = session.getCurrentUserId();

  fake.lookups[0]!("old-user");
  await stale;
  const again = session.getCurrentUserId();
  assert.equal(fake.lookups.length, 2, "the newer lookup is reused, not started a third time");

  fake.lookups[1]!("new-user");
  assert.equal(await fresh, "new-user");
  assert.equal(await again, "new-user");
});

test("a stale lookup that settles after the cache refilled leaves it alone", async () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  const stale = session.getCurrentUserId();
  fake.authChanged();
  const fresh = session.getCurrentUserId();
  fake.lookups[1]!("new-user");
  await fresh;

  fake.lookups[0]!("old-user");
  await stale;
  assert.equal(await session.getCurrentUserId(), "new-user");
});

test("sign-out clears the cached id", async () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  const first = session.getCurrentUserId();
  fake.lookups[0]!("u1");
  await first;

  fake.authChanged();
  const after = session.getCurrentUserId();
  fake.lookups[1]!(null);
  assert.equal(await after, null);
  await assert.rejects(session.requireUserId(), /Not signed in/);
});

test("dispose stops listening for auth changes (09-10)", () => {
  const fake = fakeClient();
  const session = new SupabaseSessionProvider(fake.db);
  assert.equal(fake.listeners.size, 1);
  session.dispose();
  assert.equal(fake.listeners.size, 0);
  session.dispose();
});

test("providers built and disposed per container do not pile up listeners (09-10)", () => {
  const fake = fakeClient();
  for (let i = 0; i < 3; i += 1) new SupabaseSessionProvider(fake.db).dispose();
  assert.equal(fake.listeners.size, 0);
});
