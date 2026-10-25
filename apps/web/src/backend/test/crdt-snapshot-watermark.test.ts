import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CrdtSnapshotStore } from "@/features/collab/infrastructure/crdt-snapshot-store";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * Reading the snapshot watermark, against the real migrations and the real
 * builder. Compaction writes it inside `compact_crdt_log`, so the app only reads.
 */
async function ownerAndPage() {
  const db = await testDb();
  const owner = await db.createUser();
  const [page] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title) values ($1, $2) returning id",
    [owner, "Collaborative note"],
  );
  const store = new CrdtSnapshotStore(
    createLocalClient(db.as(owner).sql as LocalQuery) as unknown as SupabaseClient,
  );
  return { db, owner, pageId: page!.id, store };
}

test("an unset watermark reads as 0", async () => {
  const { pageId, store } = await ownerAndPage();
  assert.equal(await store.getSnapshotUpto("vault_page", pageId), 0);
});

test("a set watermark reads back as a number", async () => {
  const { db, owner, pageId, store } = await ownerAndPage();
  await db.as(owner).sql("update vault_pages set snapshot_upto = $1 where id = $2", [250, pageId]);
  assert.equal(await store.getSnapshotUpto("vault_page", pageId), 250);
});

test("a resource type with no CRDT table reads as 0", async () => {
  const { pageId, store } = await ownerAndPage();
  assert.equal(await store.getSnapshotUpto("paper", pageId), 0);
});
