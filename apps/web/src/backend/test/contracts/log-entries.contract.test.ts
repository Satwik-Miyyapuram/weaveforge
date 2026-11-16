// contract-repos: log_entries
import assert from "node:assert/strict";
import test from "node:test";
import type { ILogEntryManager, ILogEntryRepository, LogEntry } from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `ILogEntryRepository` contract, end to end: Rust plans each query, the TS
 * sender runs it against PGlite with the real `log_entries` migration and RLS.
 * Ported from the deleted `log-entry-repository-contract.ts` suite.
 */

async function repoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustRepository<ILogEntryRepository & ILogEntryManager>(
    clientFor(db, userId),
    "log_entries",
    ["getById", "list", "save", "delete", "add", "update", "remove"],
    projectUserCtx(projectFor(projectId)),
  );
}

function sampleEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    entryDate: "2026-06-24",
    kind: "daily",
    body: "Read three papers on latent diffusion.",
    links: [],
    createdAt: now,
    ...overrides,
  };
}

test("save then getById returns the entity", async () => {
  const repo = await repoFor(await testDb());
  const entry = sampleEntry();
  await repo.save(entry);
  const found = await repo.getById(entry.id);
  assert.equal(found!.body, entry.body);
});

test("getById returns null when absent", async () => {
  const repo = await repoFor(await testDb());
  assert.equal(await repo.getById(crypto.randomUUID()), null);
});

test("list filters by kind", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(sampleEntry({ id: a, kind: "weekly" }));
  await repo.save(sampleEntry({ kind: "daily" }));
  const weekly = await repo.list({ kind: "weekly" });
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0]?.id, a);
});

test("list filters by date range (inclusive)", async () => {
  const repo = await repoFor(await testDb());
  const b = crypto.randomUUID();
  await repo.save(sampleEntry({ entryDate: "2026-06-01" }));
  await repo.save(sampleEntry({ id: b, entryDate: "2026-06-15" }));
  await repo.save(sampleEntry({ entryDate: "2026-06-30" }));
  const mid = await repo.list({ dateFrom: "2026-06-10", dateTo: "2026-06-20" });
  assert.equal(mid.length, 1);
  assert.equal(mid[0]?.id, b);
});

test("list ignores bodyContains on the server (bodies are encrypted)", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await repo.save(sampleEntry({ id: a, body: "Trained the VAE" }));
  await repo.save(sampleEntry({ id: b, body: "Wrote intro section" }));
  const all = await repo.list({ bodyContains: "vae" });
  assert.deepEqual(all.map((e) => e.id).sort(), [a, b].sort());
});

test("list returns most recent entryDate first", async () => {
  const repo = await repoFor(await testDb());
  const fresh = crypto.randomUUID();
  await repo.save(sampleEntry({ entryDate: "2026-06-01" }));
  await repo.save(sampleEntry({ id: fresh, entryDate: "2026-06-20" }));
  const all = await repo.list();
  assert.equal(all[0]?.id, fresh);
});

test("delete removes the entity", async () => {
  const repo = await repoFor(await testDb());
  const entry = sampleEntry();
  await repo.save(entry);
  await repo.delete(entry.id);
  assert.equal(await repo.getById(entry.id), null);
});

test("save is idempotent upsert on id", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(sampleEntry({ id: a, body: "v1" }));
  await repo.save(sampleEntry({ id: a, body: "v2" }));
  const found = await repo.getById(a);
  assert.equal(found?.body, "v2");
  const all = await repo.list();
  assert.equal(all.length, 1);
});
