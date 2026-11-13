// contract-repos: share_links, shared_items
import assert from "node:assert/strict";
import test from "node:test";
import type { ShareLinkSaveInput } from "@weaveforge/core";
import { rustRepository, rustShareLinkRepository } from "@/backend/providers/postgrest/rust-repository";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IShareLinkRepository` and shared-item reader contracts, end to end: Rust
 * plans each query, the TS sender runs it against PGlite with the real
 * `share_links`, `shares` and `papers` migrations and RLS.
 */

const NOW = "2026-06-24T00:00:00.000Z";
const TOKEN_HASH = new Uint8Array([1, 2, 3, 4]);

async function linksFor(db: Db) {
  const userId = await db.createUser();
  return { userId, repo: rustShareLinkRepository(clientFor(db, userId)) };
}

function sampleLink(ownerId: string, overrides: Partial<ShareLinkSaveInput> = {}): ShareLinkSaveInput {
  return {
    id: crypto.randomUUID(),
    ownerId,
    resourceType: "paper",
    resourceId: crypto.randomUUID(),
    access: "view",
    tokenHash: crypto.getRandomValues(new Uint8Array(32)),
    expiresAt: null,
    ...overrides,
  };
}

test("save then getById returns every field", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const input = sampleLink(userId, { expiresAt: "2099-01-01T00:00:00.000Z" });

  await repo.save(input);
  const found = await repo.getById(input.id);

  assert.ok(found);
  assert.equal(found.id, input.id);
  assert.equal(found.ownerId, userId);
  assert.equal(found.resourceType, "paper");
  assert.equal(found.resourceId, input.resourceId);
  assert.equal(found.access, "view");
  assert.equal(found.expiresAt, "2099-01-01T00:00:00.000Z");
  assert.equal(typeof found.createdAt, "string");
  assert.ok(found.createdAt.length > 0);
});

test("listForResource is scoped to the resource", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const resourceA = crypto.randomUUID();
  const resourceB = crypto.randomUUID();
  const linkA = sampleLink(userId, { resourceId: resourceA });
  await repo.save(linkA);
  await repo.save(sampleLink(userId, { resourceId: resourceB }));

  const listed = await repo.listForResource("paper", resourceA);

  assert.deepEqual(
    listed.map((l) => l.id),
    [linkA.id],
  );
});

test("delete removes the link", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const input = sampleLink(userId);
  await repo.save(input);

  await repo.delete(input.id);

  assert.equal(await repo.getById(input.id), null);
});

test("redeem resolves a live link by its token hash", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const input = sampleLink(userId, { tokenHash: TOKEN_HASH });
  await repo.save(input);

  const resolved = await repo.redeem(TOKEN_HASH);

  assert.ok(resolved);
  assert.equal(resolved.id, input.id);
  assert.equal(resolved.ownerId, userId);
  assert.equal(resolved.resourceId, input.resourceId);
  assert.equal(resolved.access, "view");
});

test("an expired link does not resolve", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const hash = crypto.getRandomValues(new Uint8Array(32));
  await repo.save(sampleLink(userId, { tokenHash: hash, expiresAt: "2001-01-01T00:00:00.000Z" }));

  assert.equal(await repo.redeem(hash), null);
});

test("a revoked link does not resolve", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const hash = crypto.getRandomValues(new Uint8Array(32));
  const input = sampleLink(userId, { tokenHash: hash });
  await repo.save(input);
  await repo.delete(input.id);

  assert.equal(await repo.redeem(hash), null);
});

test("a stranger cannot read a share link", async () => {
  const db = await testDb();
  const { userId, repo } = await linksFor(db);
  const input = sampleLink(userId);
  await repo.save(input);
  const strangerId = await db.createUser();
  const stranger = rustShareLinkRepository(clientFor(db, strangerId));

  assert.equal(await stranger.getById(input.id), null);
  assert.deepEqual(await stranger.listForResource("paper", input.resourceId), []);
});

// ---------------------------------------------------------------- shared_items

function sharedReader(db: Db, userId: string): ISharedReader {
  return rustRepository<ISharedReader>(clientFor(db, userId), "shared_items", ["read"]);
}

async function sharedPaper(db: Db) {
  const ownerId = await db.createUser();
  const projectId = await seedProject(db, ownerId);
  const papers = rustPaperRepository(clientFor(db, ownerId), projectFor(projectId));
  const paper = {
    id: crypto.randomUUID(),
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma"],
    status: "to_read" as const,
    tags: [],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };
  await papers.save(paper);
  return { ownerId, paper };
}

async function grant(db: Db, ownerId: string, recipientId: string, resourceId: string) {
  await db.sql(
    "insert into shares (owner_id, recipient_id, resource_type, resource_id, access) values ($1, $2, 'paper', $3, 'view')",
    [ownerId, recipientId, resourceId],
  );
}

test("a recipient reads a paper shared with them", async () => {
  const db = await testDb();
  const { ownerId, paper } = await sharedPaper(db);
  const recipientId = await db.createUser();
  await grant(db, ownerId, recipientId, paper.id);

  const items = await sharedReader(db, recipientId).read("paper", [paper.id], []);

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, paper.id);
  assert.equal(items[0]!.title, paper.title);
  assert.equal(items[0]!.ownerId, ownerId);
});

test("shared items are scoped to the granted ids", async () => {
  const db = await testDb();
  const { ownerId, paper } = await sharedPaper(db);
  const other = await sharedPaper(db);
  const recipientId = await db.createUser();
  await grant(db, ownerId, recipientId, paper.id);

  const items = await sharedReader(db, recipientId).read("paper", [paper.id, other.paper.id], []);

  assert.deepEqual(
    items.map((i) => i.id),
    [paper.id],
  );
});

test("a stranger cannot read a shared paper", async () => {
  const db = await testDb();
  const { ownerId, paper } = await sharedPaper(db);
  const recipientId = await db.createUser();
  await grant(db, ownerId, recipientId, paper.id);
  const strangerId = await db.createUser();

  assert.deepEqual(await sharedReader(db, strangerId).read("paper", [paper.id], []), []);
});

test("a revoked share stops being readable", async () => {
  const db = await testDb();
  const { ownerId, paper } = await sharedPaper(db);
  const recipientId = await db.createUser();
  await grant(db, ownerId, recipientId, paper.id);
  await db.sql("delete from shares where resource_id = $1", [paper.id]);

  assert.deepEqual(await sharedReader(db, recipientId).read("paper", [paper.id], []), []);
});
