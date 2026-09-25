import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseCrdtUpdateStore } from "@/features/collab/infrastructure/supabase-crdt-update-store";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * `compact_crdt_log` (migration 0132), against the real migrations.
 *
 * Compaction used to be two calls from the client: advance the watermark, then
 * delete. Both halves of that are wrong in a way a unit test cannot show, which is
 * why this file exists:
 *
 *   * **the rights check.** `snapshot_upto` is on the entity row, which RLS lets
 *     anyone who can *view* it attempt; the delete is filtered by the delete
 *     policy and PostgREST answers a filtered delete with `204 No Content`. So a
 *     commenter's compaction advanced the shared watermark past rows that were
 *     still there, and the owner's next compaction read a watermark that already
 *     covered them and swept nothing — the log grew for the life of the document,
 *     silently. The test below shares a page with a commenter and asserts both
 *     halves: the call is refused *and* the watermark has not moved.
 *   * **the transaction.** One function is one transaction, so there is no
 *     interleaving in which the watermark covers rows that were not deleted.
 *
 * `db.as(user)` runs through the same PostgREST-shaped builder the app uses, so
 * the statements under test are the ones the app would send.
 */

async function pageOwnedBy(ownerId: string) {
  const db = await testDb();
  const [page] = await db.as(ownerId).sql<{ id: string }>(
    "insert into vault_pages (user_id, title) values ($1, $2) returning id",
    [ownerId, "Compactable note"],
  );
  return { db, pageId: page!.id };
}

function storeFor(db: Awaited<ReturnType<typeof testDb>>, as: string) {
  return new SupabaseCrdtUpdateStore(
    createLocalClient(db.as(as).sql as LocalQuery) as unknown as SupabaseClient,
  );
}

/** Append `count` update rows, so there is something to sweep. */
async function appendUpdates(
  store: SupabaseCrdtUpdateStore,
  pageId: string,
  count: number,
  authorId: string,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const saved = await store.append({
      resourceType: "vault_page",
      resourceId: pageId,
      projectId: null,
      epoch: 1,
      payload: new Uint8Array([i]),
      authorId,
    });
    ids.push(saved.id);
  }
  return ids;
}

async function watermarkOf(db: Awaited<ReturnType<typeof testDb>>, as: string, pageId: string) {
  const [row] = await db
    .as(as)
    .sql<{ snapshot_upto: number | string | null }>("select snapshot_upto from vault_pages where id = $1", [pageId]);
  return row!.snapshot_upto === null ? 0 : Number(row!.snapshot_upto);
}

test("the owner compacts: the watermark moves and the covered rows go", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const { pageId } = await pageOwnedBy(owner);
  const store = storeFor(db, owner);
  const ids = await appendUpdates(store, pageId, 3, owner);

  const outcome = await store.compact({ resourceType: "vault_page", resourceId: pageId, uptoId: ids[1]! });

  assert.deepEqual(outcome, { status: "compacted", deleted: 2 }, "two rows at or below the watermark");
  assert.equal(await watermarkOf(db, owner, pageId), ids[1]);
  const remaining = await store.listAfter("vault_page", pageId);
  assert.deepEqual(
    remaining.map((row) => row.id),
    [ids[2]],
    "and only the uncovered tail is left — it is what reconstruction replays",
  );
});

test("a commenter is refused, and the watermark does not move", async () => {
  // The defect this migration exists for. Before it, this call deleted nothing
  // (RLS filtered it, PostgREST said 204) but the watermark advanced anyway, so
  // the owner's *next* compaction saw a watermark covering rows that were still
  // there and swept nothing. Silent, and permanent.
  const db = await testDb();
  const owner = await db.createUser();
  const commenter = await db.createUser();
  const { pageId } = await pageOwnedBy(owner);
  const ownerStore = storeFor(db, owner);
  const ids = await appendUpdates(ownerStore, pageId, 3, owner);

  await db.as(owner).sql(
    "insert into shares (owner_id, recipient_id, resource_type, resource_id, access) values ($1, $2, 'vault_page', $3, 'comment')",
    [owner, commenter, pageId],
  );

  const commenterStore = storeFor(db, commenter);
  const outcome = await commenterStore.compact({
    resourceType: "vault_page",
    resourceId: pageId,
    uptoId: ids[2]!,
  });

  assert.deepEqual(outcome, { status: "not-permitted" });
  assert.equal(await watermarkOf(db, owner, pageId), 0, "and crucially, the watermark is untouched");

  // The owner can still compact the whole range — which is what the old
  // behaviour took away.
  const after = await ownerStore.compact({ resourceType: "vault_page", resourceId: pageId, uptoId: ids[2]! });
  assert.deepEqual(after, { status: "compacted", deleted: 3 });
});

test("a stranger is refused as well", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const stranger = await db.createUser();
  const { pageId } = await pageOwnedBy(owner);
  const ids = await appendUpdates(storeFor(db, owner), pageId, 1, owner);

  const outcome = await storeFor(db, stranger).compact({
    resourceType: "vault_page",
    resourceId: pageId,
    uptoId: ids[0]!,
  });

  assert.deepEqual(outcome, { status: "not-permitted" });
  assert.equal(await watermarkOf(db, owner, pageId), 0);
});

test("compaction moves the watermark forwards only", async () => {
  // Two clients co-editing means two can compact; a stale one must not rewind,
  // because the loader replays from the watermark.
  const db = await testDb();
  const owner = await db.createUser();
  const { pageId } = await pageOwnedBy(owner);
  const store = storeFor(db, owner);
  const ids = await appendUpdates(store, pageId, 3, owner);

  await store.compact({ resourceType: "vault_page", resourceId: pageId, uptoId: ids[2]! });
  const stale = await store.compact({ resourceType: "vault_page", resourceId: pageId, uptoId: ids[0]! });

  assert.deepEqual(stale, { status: "compacted", deleted: 0 }, "nothing left to sweep below the watermark");
  assert.equal(await watermarkOf(db, owner, pageId), ids[2], "and the watermark has not moved back");
});

test("the local answer for a stale caller matches what the database would do", async () => {
  const db = await testDb();
  const owner = await db.createUser();
  const { pageId } = await pageOwnedBy(owner);
  const store = storeFor(db, owner);
  const ids = await appendUpdates(store, pageId, 2, owner);
  await store.compact({ resourceType: "vault_page", resourceId: pageId, uptoId: ids[1]! });

  const outcome = await store.compact({
    resourceType: "vault_page",
    resourceId: pageId,
    uptoId: ids[0]!,
    currentUpto: ids[1]!,
  });

  assert.deepEqual(outcome, { status: "no-op", reason: "stale" });
});

test("compacting a resource that is gone is a no-op, not a failure", async () => {
  // A client closing a deleted document would otherwise log a failure every time.
  const db = await testDb();
  const owner = await db.createUser();

  const outcome = await storeFor(db, owner).compact({
    resourceType: "vault_page",
    resourceId: "00000000-0000-0000-0000-0000000000ff",
    uptoId: 5,
  });

  assert.deepEqual(outcome, { status: "no-op", reason: "missing" });
});
