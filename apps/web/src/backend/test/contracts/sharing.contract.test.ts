// contract-repos: shares, comments
import assert from "node:assert/strict";
import test from "node:test";
import type { ICommentRepository, IShareRepository } from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `IShareRepository` and `ICommentRepository` contract, end to end: Rust plans
 * each query, the TS sender runs it against PGlite with the real migrations and
 * RLS. Ported from the deleted `sharing-repository-contract.ts` suite.
 *
 * Every resource is a real `vault_page` owned by the acting user, so the rows the
 * database checks exist (a share or comment on a missing resource is not a case
 * the contract covers).
 */

function sharesFor(db: Db, userId: string, projectId: string) {
  return rustRepository<IShareRepository>(
    clientFor(db, userId),
    "shares",
    ["grant", "revoke", "listForResource", "listSharedWithMe"],
    projectUserCtx(projectFor(projectId), sessionFor(userId)),
  );
}

function commentsFor(db: Db, userId: string) {
  return rustRepository<ICommentRepository>(clientFor(db, userId), "comments", ["list", "add", "remove", "setResolved"]);
}

async function ownerWithProject(db: Db) {
  const owner = await db.createUser();
  const projectId = await seedProject(db, owner);
  return { owner, projectId };
}

async function pageOwnedBy(db: Db, owner: string): Promise<string> {
  const [row] = await db.as(owner).sql<{ id: string }>(
    "insert into vault_pages (user_id, title, body) values ($1, $2, 'text') returning id",
    [owner, `Page ${crypto.randomUUID().slice(0, 8)}`],
  );
  return row!.id;
}

test("grant then listForResource returns the grant", async () => {
  const db = await testDb();
  const { owner, projectId } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const recipient = await db.createUser();
  const repo = sharesFor(db, owner, projectId);
  const s = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId });
  assert.equal(s.recipientId, recipient);
  assert.equal(s.access, "comment"); // default
  const list = await repo.listForResource("vault_page", pageId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.recipientId, recipient);
});

test("grant is idempotent and updates access", async () => {
  const db = await testDb();
  const { owner, projectId } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const recipient = await db.createUser();
  const repo = sharesFor(db, owner, projectId);
  await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "comment" });
  await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId, access: "view" });
  const list = await repo.listForResource("vault_page", pageId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.access, "view");
});

test("blanket grant (null resource) is separate from per-item", async () => {
  const db = await testDb();
  const { owner, projectId } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const bob = await db.createUser();
  const carol = await db.createUser();
  const repo = sharesFor(db, owner, projectId);
  await repo.grant({ recipientId: bob, resourceType: "vault_page", resourceId: pageId });
  await repo.grant({ recipientId: carol, resourceType: "vault_page", resourceId: null });
  assert.equal((await repo.listForResource("vault_page", pageId)).length, 1);
  assert.equal((await repo.listForResource("vault_page", null)).length, 1);
});

test("revoke removes the grant", async () => {
  const db = await testDb();
  const { owner, projectId } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const recipient = await db.createUser();
  const repo = sharesFor(db, owner, projectId);
  const s = await repo.grant({ recipientId: recipient, resourceType: "vault_page", resourceId: pageId });
  await repo.revoke(s.id);
  assert.equal((await repo.listForResource("vault_page", pageId)).length, 0);
});

test("add then list returns oldest-first", async () => {
  const db = await testDb();
  const { owner } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const repo = commentsFor(db, owner);
  await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "first" });
  await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "second" });
  const list = await repo.list("vault_page", pageId);
  assert.deepEqual(list.map((c) => c.body), ["first", "second"]);
});

test("list scopes to the resource", async () => {
  const db = await testDb();
  const { owner } = await ownerWithProject(db);
  const pageA = await pageOwnedBy(db, owner);
  const pageB = await pageOwnedBy(db, owner);
  const repo = commentsFor(db, owner);
  await repo.add({ resourceType: "vault_page", resourceId: pageA, body: "a" });
  await repo.add({ resourceType: "vault_page", resourceId: pageB, body: "b" });
  assert.equal((await repo.list("vault_page", pageA)).length, 1);
});

test("remove deletes a comment", async () => {
  const db = await testDb();
  const { owner } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const repo = commentsFor(db, owner);
  const c = await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "x" });
  await repo.remove(c.id);
  assert.equal((await repo.list("vault_page", pageId)).length, 0);
});

test("a reply keeps its root, and goes when the root goes", async () => {
  const db = await testDb();
  const { owner } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const repo = commentsFor(db, owner);
  const anchor = { quote: "the claim", prefix: "see ", suffix: " here" };
  const root = await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "why this?", anchor });
  const reply = await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "because", parentId: root.id });
  const list = await repo.list("vault_page", pageId);
  assert.deepEqual(list.find((c) => c.id === root.id)?.anchor, anchor);
  assert.equal(list.find((c) => c.id === reply.id)?.parentId, root.id);
  await repo.remove(root.id);
  assert.equal((await repo.list("vault_page", pageId)).length, 0);
});

test("a thread resolves and reopens at its root", async () => {
  const db = await testDb();
  const { owner } = await ownerWithProject(db);
  const pageId = await pageOwnedBy(db, owner);
  const repo = commentsFor(db, owner);
  const root = await repo.add({ resourceType: "vault_page", resourceId: pageId, body: "fix" });
  assert.ok(await repo.setResolved(root.id, true));
  assert.ok((await repo.list("vault_page", pageId))[0]?.resolvedAt);
  assert.equal(await repo.setResolved(root.id, false), null);
  assert.equal((await repo.list("vault_page", pageId))[0]?.resolvedAt ?? null, null);
});
