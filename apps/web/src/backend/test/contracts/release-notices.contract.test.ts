// contract-repos: release_notices
import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgrestSettingsRepository,
  type IReleaseNoticesRepository,
  type Secrets,
  type SecretsStore,
} from "@/features/settings/infrastructure/parts";
import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, sessionFor, type Db } from "./harness";

/**
 * The `IReleaseNoticesRepository` contract, end to end against PGlite with the real
 * migrations and RLS.
 */

/** Persists in memory so a saved `zoteroApiKey` reads back, as the sealed server store would. */
function memorySecrets(): SecretsStore {
  let stored: Secrets = {};
  return {
    load: async () => stored,
    save: async (secrets: Secrets) => {
      stored = { ...secrets };
    },
  };
}

async function reposFor(db: Db) {
  const userId = await db.createUser();
  const client = clientFor(db, userId);
  const session = sessionFor(userId);
  const notices = rustRepository<IReleaseNoticesRepository>(client, "release_notices", ["unseen"], async () => ({
    userId,
  }));
  const settings = new PostgrestSettingsRepository(client, session, memorySecrets());
  return { notices, settings };
}

/** Publish a notice as superuser; the test DB is shared, so each test uses its own far-future timestamp. */
async function publish(db: Db, version: string, publishedAt: string) {
  await db.sql(
    "insert into release_notices (version, title, body, published_at) values ($1, $2, $3, $4) on conflict (version) do update set published_at = excluded.published_at",
    [version, `WeaveForge ${version}`, `Notes for ${version}`, publishedAt],
  );
}

test("unseen returns the newest notice to a user who has not dismissed it", async () => {
  const db = await testDb();
  const { notices } = await reposFor(db);
  await publish(db, "9.1.0-a", "2999-01-01T00:00:00Z");
  const n = await notices.unseen();
  assert.equal(n?.version, "9.1.0-a");
  assert.equal(n?.title, "WeaveForge 9.1.0-a");
  assert.equal(n?.body, "Notes for 9.1.0-a");
  assert.equal(typeof n?.publishedAt, "string");
});

test("dismissing hides the notice for that account", async () => {
  const db = await testDb();
  const { notices, settings } = await reposFor(db);
  await publish(db, "9.1.0-b", "2999-02-01T00:00:00Z");
  assert.equal((await notices.unseen())?.version, "9.1.0-b");
  await settings.saveNoticeSeen("9.1.0-b");
  assert.equal(await notices.unseen(), null);
});

test("a newer notice shows again after an older one was dismissed", async () => {
  const db = await testDb();
  const { notices, settings } = await reposFor(db);
  await publish(db, "9.1.0-c1", "2999-03-01T00:00:00Z");
  await settings.saveNoticeSeen("9.1.0-c1");
  await publish(db, "9.1.0-c2", "2999-03-02T00:00:00Z");
  assert.equal((await notices.unseen())?.version, "9.1.0-c2");
});

test("saveNoticeSeen keeps the rest of the settings row", async () => {
  const db = await testDb();
  const { settings } = await reposFor(db);
  const before = await settings.get();
  await settings.save({ ...before, zoteroApiKey: "key-n" } as Parameters<typeof settings.save>[0]);
  await settings.saveNoticeSeen("9.1.0-d");
  assert.equal((await settings.get()).zoteroApiKey, "key-n");
});
