import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CrdtSnapshotStore } from "@/features/collab/infrastructure/crdt-snapshot-store";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * The snapshot watermark, against the real migrations and the real builder.
 *
 * The predicate is the interesting part. `snapshot_upto` begins as null
 * (migration 0042), so a plain `lt` guard never matches the first compaction and
 * the feature would simply never run — the guard has to say "unset, or older".
 * It also has to compare as a number: the local client parameterises the value
 * from the PostgREST-style expression as a string, and `bigint < text` is a type
 * error in Postgres rather than a false answer, so this is a case a unit test on
 * the emitted SQL could not settle.
 */
async function ownerAndPage() {
  const db = await testDb();
  const owner = await db.createUser();
  const [page] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title) values ($1, $2) returning id",
    [owner, "Collaborative note"],
  );
  // `db.as(...)` runs through the same PostgREST-shaped builder the app uses, so
  // the statements under test are the ones the app would send.
  const store = new CrdtSnapshotStore(
    createLocalClient(db.as(owner).sql as LocalQuery) as unknown as SupabaseClient,
  );
  return { db, owner, pageId: page!.id, store };
}

test("the watermark starts unset, and the first compaction sets it", async () => {
  const { db, owner, pageId, store } = await ownerAndPage();
  assert.equal(await store.getSnapshotUpto("vault_page", pageId), 0);

  await store.setSnapshotUpto("vault_page", pageId, 100);

  const [row] = await db
    .as(owner)
    .sql<{ snapshot_upto: number | string }>(
      "select snapshot_upto from vault_pages where id = $1",
      [pageId],
    );
  assert.equal(Number(row!.snapshot_upto), 100, "an unset watermark must accept the first value");
});

test("a stale caller cannot move the watermark backwards", async () => {
  const { db, owner, pageId, store } = await ownerAndPage();
  await store.setSnapshotUpto("vault_page", pageId, 200);

  // A second client that read the watermark before that compaction ran.
  await store.setSnapshotUpto("vault_page", pageId, 100);

  const [row] = await db
    .as(owner)
    .sql<{ snapshot_upto: number | string }>(
      "select snapshot_upto from vault_pages where id = $1",
      [pageId],
    );
  assert.equal(Number(row!.snapshot_upto), 200, "the watermark only ever moves forwards");
});

test("a newer caller still advances it", async () => {
  const { db, owner, pageId, store } = await ownerAndPage();
  await store.setSnapshotUpto("vault_page", pageId, 100);
  await store.setSnapshotUpto("vault_page", pageId, 250);

  const [row] = await db
    .as(owner)
    .sql<{ snapshot_upto: number | string }>(
      "select snapshot_upto from vault_pages where id = $1",
      [pageId],
    );
  assert.equal(Number(row!.snapshot_upto), 250);
});

test("a watermark write cannot reach another user's row", async () => {
  const { db, store } = await ownerAndPage();
  const stranger = await db.createUser();
  const [other] = await db.as(stranger).sql<{ id: string }>(
    "insert into vault_pages (user_id, title) values ($1, $2) returning id",
    [stranger, "Not yours"],
  );

  await store.setSnapshotUpto("vault_page", other!.id, 100);

  const [row] = await db
    .as(stranger)
    .sql<{ snapshot_upto: number | string | null }>(
      "select snapshot_upto from vault_pages where id = $1",
      [other!.id],
    );
  assert.equal(row!.snapshot_upto, null, "RLS still scopes the write to the caller's own rows");
});
