// contract-repos: ai_audit, ai_proposals, project_integrations
import assert from "node:assert/strict";
import test from "node:test";
import type { AiWriteProposal, AiAuditRecord } from "@weaveforge/core";
import { rustAiStores } from "@/backend/providers/postgrest/rust-repository";
import { rustIntegrationsStore } from "@/backend/providers/postgrest/wire-postgrest-backend";
import type { Integration } from "@/features/sync/domain/parts";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `ai_audit`, `ai_proposals` and `project_integrations` contracts, end to end:
 * Rust plans each query, the TS sender runs it against PGlite with the real
 * migrations and RLS. No old TS suite exists; these cases are written from the
 * Rust `step` matches and record mappings.
 */

async function aiFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const stores = rustAiStores(clientFor(db, userId), projectFor(projectId), sessionFor(userId));
  return { userId, projectId, ...stores };
}

function sampleProposal(overrides: Partial<AiWriteProposal> = {}): AiWriteProposal {
  return {
    id: crypto.randomUUID(),
    kind: "append_paper_note",
    resourceId: crypto.randomUUID(),
    content: "Draft text",
    createdAt: "2026-06-24T00:00:00.000Z",
    status: "pending",
    sourceLinks: ["https://example.test/a"],
    expectedRevision: "rev-1",
    ...overrides,
  };
}

function sampleAudit(proposalId: string, overrides: Partial<AiAuditRecord> = {}): AiAuditRecord {
  return {
    id: crypto.randomUUID(),
    proposalId,
    action: "accepted",
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

test("save audit record then countAccepted counts the accepted action", async () => {
  const db = await testDb();
  const { audit, proposals } = await aiFor(db);
  assert.equal(await audit.countAccepted(), 0);
  const p = sampleProposal();
  await proposals.save(p);
  await audit.save(sampleAudit(p.id, { action: "accepted" }));
  assert.equal(await audit.countAccepted(), 1);
});

test("countAccepted ignores rejected and conflicted audit actions", async () => {
  const db = await testDb();
  const { audit, proposals } = await aiFor(db);
  const p = sampleProposal();
  await proposals.save(p);
  await audit.save(sampleAudit(p.id, { action: "rejected" }));
  await audit.save(sampleAudit(p.id, { action: "conflicted" }));
  assert.equal(await audit.countAccepted(), 0);
});

test("countAccepted is scoped to the project (another project's rows absent)", async () => {
  const db = await testDb();
  const mine = await aiFor(db);
  const other = await aiFor(db);
  const p = sampleProposal();
  await other.proposals.save(p);
  await other.audit.save(sampleAudit(p.id, { action: "accepted" }));
  assert.equal(await mine.audit.countAccepted(), 0);
  assert.equal(await other.audit.countAccepted(), 1);
});

test("a stranger's countAccepted sees none of the project's audit rows", async () => {
  const db = await testDb();
  const owner = await aiFor(db);
  const p = sampleProposal();
  await owner.proposals.save(p);
  await owner.audit.save(sampleAudit(p.id, { action: "accepted" }));
  const strangerId = await db.createUser();
  const stranger = rustAiStores(clientFor(db, strangerId), projectFor(owner.projectId), sessionFor(strangerId));
  assert.equal(await stranger.audit.countAccepted(), 0);
});

test("save then getById returns every proposal field", async () => {
  const db = await testDb();
  const { proposals } = await aiFor(db);
  const p = sampleProposal();
  await proposals.save(p);
  const got = await proposals.getById(p.id);
  assert.ok(got);
  assert.equal(got.id, p.id);
  assert.equal(got.kind, p.kind);
  assert.equal(got.resourceId, p.resourceId);
  assert.equal(got.content, p.content);
  assert.equal(got.createdAt, p.createdAt);
  assert.equal(got.status, "pending");
  assert.deepEqual(got.sourceLinks, p.sourceLinks);
  assert.equal(got.expectedRevision, p.expectedRevision);
});

test("listPending returns only this project's pending proposals", async () => {
  const db = await testDb();
  const mine = await aiFor(db);
  const other = await aiFor(db);
  const pending = sampleProposal();
  await mine.proposals.save(pending);
  await mine.proposals.save(sampleProposal({ status: "accepted" }));
  await other.proposals.save(sampleProposal());
  const list = await mine.proposals.listPending();
  assert.deepEqual(list.map((p) => p.id), [pending.id]);
});

test("claimPending moves pending to executing once; a second claim is refused", async () => {
  const db = await testDb();
  const { proposals } = await aiFor(db);
  const p = sampleProposal();
  await proposals.save(p);
  assert.equal(await proposals.claimPending(p.id), true);
  assert.equal((await proposals.getById(p.id))!.status, "executing");
  assert.equal(await proposals.claimPending(p.id), false);
});

test("accepted and rejected proposals keep their status and cannot be claimed", async () => {
  const db = await testDb();
  const { proposals } = await aiFor(db);
  const accepted = sampleProposal({ status: "accepted" });
  const rejected = sampleProposal({ status: "rejected" });
  await proposals.save(accepted);
  await proposals.save(rejected);
  assert.equal(await proposals.claimPending(accepted.id), false);
  assert.equal(await proposals.claimPending(rejected.id), false);
  assert.equal((await proposals.getById(accepted.id))!.status, "accepted");
  assert.equal((await proposals.getById(rejected.id))!.status, "rejected");
});

test("a stranger cannot read or claim another user's proposals", async () => {
  const db = await testDb();
  const owner = await aiFor(db);
  const p = sampleProposal();
  await owner.proposals.save(p);
  const strangerId = await db.createUser();
  const stranger = rustAiStores(clientFor(db, strangerId), projectFor(owner.projectId), sessionFor(strangerId));
  assert.equal(await stranger.proposals.getById(p.id), null);
  assert.deepEqual(await stranger.proposals.listPending(), []);
  assert.equal(await stranger.proposals.claimPending(p.id), false);
});

test("saving an integration then reading it back returns every field", async () => {
  const db = await testDb();
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const store = rustIntegrationsStore(clientFor(db, userId));
  const integration: Integration = {
    provider: "github",
    enabled: true,
    token: "ghp_test",
    repo: "owner/name",
    branch: "dev",
    options: { label: "x" },
  };
  await store.save(projectId, integration);
  const got = await store.get(projectId, "github");
  assert.equal(got.provider, "github");
  assert.equal(got.enabled, true);
  assert.equal(got.repo, "owner/name");
  assert.equal(got.branch, "dev");
  assert.deepEqual(got.options, { label: "x" });
  assert.equal(got.token, "ghp_test");
});

test("saving an integration again overwrites the previous row", async () => {
  const db = await testDb();
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const store = rustIntegrationsStore(clientFor(db, userId));
  await store.save(projectId, { provider: "github", enabled: true, repo: "a/one", branch: "main" });
  await store.save(projectId, { provider: "github", enabled: false, repo: "a/two", branch: "dev" });
  const got = await store.get(projectId, "github");
  assert.equal(got.enabled, false);
  assert.equal(got.repo, "a/two");
  assert.equal(got.branch, "dev");
});

test("integrations are scoped to the project (another project's row absent)", async () => {
  const db = await testDb();
  const userId = await db.createUser();
  const mine = await seedProject(db, userId);
  const other = await seedProject(db, userId);
  const store = rustIntegrationsStore(clientFor(db, userId));
  await store.save(other, { provider: "gitlab", enabled: true, repo: "g/p", branch: "main" });
  const got = await store.get(mine, "gitlab");
  assert.equal(got.enabled, false);
  assert.equal(got.repo, undefined);
});

test("a stranger cannot read another user's integration row", async () => {
  const db = await testDb();
  const ownerId = await db.createUser();
  const projectId = await seedProject(db, ownerId);
  await rustIntegrationsStore(clientFor(db, ownerId)).save(projectId, {
    provider: "github",
    enabled: true,
    token: "ghp_secret",
    repo: "o/r",
    branch: "main",
  });
  const strangerId = await db.createUser();
  const got = await rustIntegrationsStore(clientFor(db, strangerId)).get(projectId, "github");
  assert.equal(got.repo, undefined);
  assert.equal(got.token, undefined);
});
