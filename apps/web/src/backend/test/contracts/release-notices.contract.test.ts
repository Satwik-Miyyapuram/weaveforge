// contract-repos: release_notices
import assert from "node:assert/strict";
import test from "node:test";
import type { IReleaseNoticesRepository } from "@/features/settings/infrastructure/parts";
import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, type Db } from "./harness";

/**
 * The `IReleaseNoticesRepository` contract, end to end against PGlite with the real
 * migrations and RLS.
 */

async function reposFor(db: Db) {
  const userId = await db.createUser();
  const client = clientFor(db, userId);
  const notices = rustRepository<IReleaseNoticesRepository>(client, "release_notices", ["latest"], async () => ({
    userId,
  }));
  return { notices };
}

/** Publish a notice as superuser; the test DB is shared, so each test uses its own far-future timestamp. */
async function publish(db: Db, version: string, publishedAt: string) {
  await db.sql(
    "insert into release_notices (version, title, body, published_at) values ($1, $2, $3, $4) on conflict (version) do update set published_at = excluded.published_at",
    [version, `WeaveForge ${version}`, `Notes for ${version}`, publishedAt],
  );
}

// Dismissal is device-local now, so this file no longer tests dismissal. Latest ignoring a dismissed row is covered by the Rust test
// release_notices.rs latest_returns_the_newest_notice_even_when_dismissed (d436148e8 dropped the web-side version).
test("latest returns the newest published notice", async () => {
  const db = await testDb();
  const { notices } = await reposFor(db);
  await publish(db, "9.1.0-e", "2999-12-01T00:00:00Z");
  const n = await notices.latest();
  assert.equal(n?.version, "9.1.0-e");
  assert.equal(n?.title, "WeaveForge 9.1.0-e");
  assert.equal(n?.body, "Notes for 9.1.0-e");
  assert.equal(typeof n?.publishedAt, "string");
});
