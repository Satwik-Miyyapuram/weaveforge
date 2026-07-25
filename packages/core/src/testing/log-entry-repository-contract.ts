/**
 * Shared CONTRACT test suite for ILogEntryRepository.
 *
 * Per the design doc's testing strategy: every implementation of
 * ILogEntryRepository (in-memory, Supabase, SQLite) must pass this identical
 * suite. That is what makes implementations Liskov-substitutable in practice.
 *
 * Usage from a test file:
 *
 *   import { runLogEntryRepositoryContract } from "../src/testing/log-entry-repository-contract.js";
 *   import { InMemoryLogEntryRepository } from "../src/testing/in-memory-log-entry-repository.js";
 *   runLogEntryRepositoryContract("InMemory", () => new InMemoryLogEntryRepository());
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogEntry } from "../features/logbook/domain/log-entry.js";
import type { ILogEntryRepository } from "../features/logbook/domain/log-entry-repository.js";

function sampleEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: overrides.id ?? "l1",
    entryDate: overrides.entryDate ?? "2026-06-24",
    kind: overrides.kind ?? "daily",
    body: overrides.body ?? "Read three papers on latent diffusion.",
    links: overrides.links ?? [],
    createdAt: overrides.createdAt ?? now,
    ...overrides,
  };
}

/**
 * Register the contract tests against a freshly-created repository.
 * `makeRepo` must return an empty repository for each invocation.
 */
export function runLogEntryRepositoryContract(
  label: string,
  makeRepo: () => ILogEntryRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const entry = sampleEntry();
    await repo.save(entry);
    const found = await repo.getById(entry.id);
    assert.ok(found);
    assert.equal(found.body, entry.body);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.getById("missing"), null);
  });

  test(`[${label}] list filters by kind`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEntry({ id: "a", kind: "weekly" }));
    await repo.save(sampleEntry({ id: "b", kind: "daily" }));
    const weekly = await repo.list({ kind: "weekly" });
    assert.equal(weekly.length, 1);
    assert.equal(weekly[0]?.id, "a");
  });

  test(`[${label}] list filters by date range (inclusive)`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEntry({ id: "a", entryDate: "2026-06-01" }));
    await repo.save(sampleEntry({ id: "b", entryDate: "2026-06-15" }));
    await repo.save(sampleEntry({ id: "c", entryDate: "2026-06-30" }));
    const mid = await repo.list({ dateFrom: "2026-06-10", dateTo: "2026-06-20" });
    assert.equal(mid.length, 1);
    assert.equal(mid[0]?.id, "b");
  });

  test(`[${label}] list filters by body substring (case-insensitive)`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEntry({ id: "a", body: "Trained the VAE" }));
    await repo.save(sampleEntry({ id: "b", body: "Wrote intro section" }));
    const hit = await repo.list({ bodyContains: "vae" });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.id, "a");
  });

  test(`[${label}] list returns most recent entryDate first`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEntry({ id: "old", entryDate: "2026-06-01" }));
    await repo.save(sampleEntry({ id: "new", entryDate: "2026-06-20" }));
    const all = await repo.list();
    assert.equal(all[0]?.id, "new");
  });

  test(`[${label}] delete removes the entity`, async () => {
    const repo = makeRepo();
    const entry = sampleEntry();
    await repo.save(entry);
    await repo.delete(entry.id);
    assert.equal(await repo.getById(entry.id), null);
  });

  test(`[${label}] save is idempotent upsert on id`, async () => {
    const repo = makeRepo();
    await repo.save(sampleEntry({ id: "a", body: "v1" }));
    await repo.save(sampleEntry({ id: "a", body: "v2" }));
    const found = await repo.getById("a");
    assert.equal(found?.body, "v2");
    const all = await repo.list();
    assert.equal(all.length, 1);
  });
}
