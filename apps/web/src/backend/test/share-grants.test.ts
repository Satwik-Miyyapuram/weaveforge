import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareAccess } from "@weaveforge/core";

import { PostgrestShareRepository } from "@/features/sharing/infrastructure/postgrest-share-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * Changing who can do what with a shared item, against the real migrations.
 *
 * A grant used to delete the existing share and insert a new one. If the insert
 * failed, the recipient had lost access the owner only meant to change; and two
 * grants racing could both delete and then collide on the unique index.
 */

type Db = Awaited<ReturnType<typeof testDb>>;

function repoFor(db: Db, as: string) {
  const session = { getCurrentUserId: async () => as, requireUserId: async () => as };
  return new PostgrestShareRepository(createLocalClient(db.as(as).sql as LocalQuery) as unknown as SupabaseClient, session);
}

async function ownedNote(db: Db) {
  const owner = await db.createUser();
  const recipient = await db.createUser();
  const [page] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title, body) values ($1, 'Draft', 'text') returning id",
    [owner],
  );
  return { owner, recipient, pageId: page!.id };
}

async function sharesOf(db: Db, owner: string) {
  return db.sql<{ id: string; access: string }>("select id, access from shares where owner_id = $1", [owner]);
}

test("changing a recipient's access keeps the same grant", async () => {
  const db = await testDb();
  const { owner, recipient, pageId } = await ownedNote(db);
  const repo = repoFor(db, owner);
  const first = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "view" });

  const changed = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "edit" });

  assert.equal(changed.id, first.id);
  assert.equal(changed.access, "edit");
  assert.deepEqual(await sharesOf(db, owner), [{ id: first.id, access: "edit" }]);
});

test("a change the database refuses leaves the existing grant in place", async () => {
  const db = await testDb();
  const { owner, recipient, pageId } = await ownedNote(db);
  const repo = repoFor(db, owner);
  const first = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "comment" });

  await assert.rejects(
    repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "admin" as ShareAccess }),
  );

  assert.deepEqual(await sharesOf(db, owner), [{ id: first.id, access: "comment" }]);
});

test("a blanket grant (no single item) changes in place too", async () => {
  const db = await testDb();
  const { owner, recipient } = await ownedNote(db);
  const repo = repoFor(db, owner);
  const first = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: null, access: "view" });

  const changed = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: null, access: "comment" });

  assert.equal(changed.id, first.id);
  assert.deepEqual(await sharesOf(db, owner), [{ id: first.id, access: "comment" }]);
});

test("two grants to the same new recipient at once both succeed and leave one share", async () => {
  const db = await testDb();
  const { owner, recipient, pageId } = await ownedNote(db);
  const repo = repoFor(db, owner);

  const [a, b] = await Promise.all([
    repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "view" }),
    repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "view" }),
  ]);

  assert.equal(a.id, b.id);
  assert.equal((await sharesOf(db, owner)).length, 1);
});

test("a grant made by someone who only views the item gives the third person nothing", async () => {
  // The share dialog lets any viewer open it, but every access check requires
  // the share's owner to own the item, so a viewer's grant is inert.
  const db = await testDb();
  const { owner, recipient: viewer, pageId } = await ownedNote(db);
  const third = await db.createUser();
  await repoFor(db, owner).grant({ recipientId: viewer, resourceType: "vault_page", resourceId: pageId, access: "view" });
  assert.equal((await db.as(viewer).sql("select id from vault_pages where id = $1", [pageId])).length, 1);

  await repoFor(db, viewer).grant({ recipientId: third, resourceType: "vault_page", resourceId: pageId, access: "edit" });

  assert.equal((await db.as(third).sql("select id from vault_pages where id = $1", [pageId])).length, 0);
});
