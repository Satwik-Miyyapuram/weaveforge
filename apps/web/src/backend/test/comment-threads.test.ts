import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseCommentRepository } from "@/features/sharing/infrastructure/supabase-comment-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import { testDb } from "./pg-test-db";

/**
 * Anchored, threaded, resolvable comments (migration 0133), against the real
 * migrations.
 *
 * The point of `set_comment_resolved` is the rights check: the note's owner may
 * resolve a commenter's thread, the commenter may resolve their own, and a third
 * person with comment access may do neither. Only a database test can show that.
 */

type Db = Awaited<ReturnType<typeof testDb>>;

function repoFor(db: Db, as: string) {
  return new SupabaseCommentRepository(createLocalClient(db.as(as).sql as LocalQuery) as unknown as SupabaseClient);
}

async function sharedNote(db: Db) {
  const owner = await db.createUser();
  const commenter = await db.createUser();
  const other = await db.createUser();
  const [page] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title, body) values ($1, 'Draft', 'we claim the effect holds') returning id",
    [owner],
  );
  for (const who of [commenter, other]) {
    await db.sql(
      "insert into shares (owner_id, recipient_id, resource_type, resource_id, access) values ($1, $2, 'vault_page', $3, 'comment')",
      [owner, who, page!.id],
    );
  }
  return { owner, commenter, other, pageId: page!.id };
}

test("an anchored comment and its reply round-trip through the repository", async () => {
  const db = await testDb();
  const { commenter, owner, pageId } = await sharedNote(db);
  const anchor = { quote: "the effect", prefix: "we claim ", suffix: " holds" };
  const root = await repoFor(db, commenter).add({ resourceType: "vault_page", resourceId: pageId, body: "cite?", anchor });
  await repoFor(db, owner).add({ resourceType: "vault_page", resourceId: pageId, body: "added", parentId: root.id });

  const list = await repoFor(db, owner).list("vault_page", pageId);
  assert.deepEqual(list.map((c) => c.body), ["cite?", "added"]);
  assert.deepEqual(list[0]!.anchor, anchor);
  assert.equal(list[1]!.parentId, root.id);
  assert.equal(list[1]!.anchor, null);
});

test("the owner resolves a commenter's thread; a bystander cannot", async () => {
  const db = await testDb();
  const { commenter, owner, other, pageId } = await sharedNote(db);
  const root = await repoFor(db, commenter).add({ resourceType: "vault_page", resourceId: pageId, body: "typo" });

  await assert.rejects(repoFor(db, other).setResolved(root.id, true), (e: { code?: string }) => e.code === "42501");
  assert.ok(await repoFor(db, owner).setResolved(root.id, true));
  assert.ok((await repoFor(db, commenter).list("vault_page", pageId))[0]!.resolvedAt);

  assert.equal(await repoFor(db, commenter).setResolved(root.id, false), null);
});

test("a reply cannot be resolved on its own, and goes with its root", async () => {
  const db = await testDb();
  const { commenter, owner, pageId } = await sharedNote(db);
  const root = await repoFor(db, commenter).add({ resourceType: "vault_page", resourceId: pageId, body: "q" });
  const reply = await repoFor(db, commenter).add({ resourceType: "vault_page", resourceId: pageId, body: "and", parentId: root.id });

  await assert.rejects(repoFor(db, owner).setResolved(reply.id, true), (e: { code?: string }) => e.code === "22023");
  await repoFor(db, commenter).remove(root.id);
  assert.equal((await repoFor(db, owner).list("vault_page", pageId)).length, 0);
});

test("set_comment_resolved is not callable by anon", async () => {
  const db = await testDb();
  const [row] = await db.sql<{ ok: boolean }>(
    "select has_function_privilege('anon', 'public.set_comment_resolved(uuid, boolean)', 'execute') as ok",
  );
  assert.equal(row!.ok, false);
});

test("a reply cannot be planted in a thread on another resource", async () => {
  const db = await testDb();
  const a = await sharedNote(db);
  const [other] = await db.as(a.owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title, body) values ($1, 'Other', 'x') returning id",
    [a.owner],
  );
  const onA = await repoFor(db, a.commenter).add({ resourceType: "vault_page", resourceId: a.pageId, body: "here" });
  await assert.rejects(
    repoFor(db, a.owner).add({ resourceType: "vault_page", resourceId: other!.id, body: "there", parentId: onA.id }),
    (e: { code?: string }) => e.code === "22023",
  );
});

test("a new comment cannot arrive already resolved", async () => {
  const db = await testDb();
  const { commenter, pageId } = await sharedNote(db);
  const [row] = await db.as(commenter).sql<{ resolved_at: string | null }>(
    "insert into comments (resource_type, resource_id, author_id, body, resolved_at) values ('vault_page', $1, $2, 'x', now()) returning resolved_at",
    [pageId, commenter],
  );
  assert.equal(row!.resolved_at, null);
});
