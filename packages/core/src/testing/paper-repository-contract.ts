/**
 * Shared CONTRACT test suite for IPaperRepository.
 *
 * Per the design doc's testing strategy: every implementation of
 * IPaperRepository (in-memory, Supabase, SQLite) must pass this identical suite.
 * That is what makes implementations Liskov-substitutable in practice.
 *
 * Usage from a test file:
 *
 *   import { describe } from "node:test";
 *   import { runPaperRepositoryContract } from "@weaveforge/core/testing";
 *   runPaperRepositoryContract("InMemory", () => new InMemoryPaperRepository());
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Paper } from "../features/papers/domain/paper.js";
import type { IPaperRepository } from "../features/papers/domain/paper-repository.js";

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: overrides.id ?? "p1",
    title: overrides.title ?? "Auto-Encoding Variational Bayes",
    authors: overrides.authors ?? ["Kingma", "Welling"],
    status: overrides.status ?? "to_read",
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    arxivId: overrides.arxivId,
    doi: overrides.doi,
    ...overrides,
  };
}

/**
 * Register the contract tests against a freshly-created repository.
 * `makeRepo` must return an empty repository for each invocation.
 */
export function runPaperRepositoryContract(
  label: string,
  makeRepo: () => IPaperRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const paper = samplePaper();
    await repo.save(paper);
    const found = await repo.getById(paper.id);
    assert.ok(found);
    assert.equal(found.title, paper.title);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.getById("missing"), null);
  });

  test(`[${label}] list filters by status`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", status: "read" }));
    await repo.save(samplePaper({ id: "b", status: "to_read" }));
    const read = await repo.list({ status: "read" });
    assert.equal(read.length, 1);
    assert.equal(read[0]?.id, "a");
  });

  test(`[${label}] list filters by title substring (case-insensitive)`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", title: "Latent Diffusion Models" }));
    await repo.save(samplePaper({ id: "b", title: "Graph Neural Networks" }));
    const hit = await repo.list({ titleContains: "latent" });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.id, "a");
  });

  test(`[${label}] findByArxivId locates the paper`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", arxivId: "1312.6114" }));
    const found = await repo.findByArxivId("1312.6114");
    assert.equal(found?.id, "a");
    assert.equal(await repo.findByArxivId("0000.0000"), null);
  });

  test(`[${label}] findByDoi locates the paper`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", doi: "10.1234/abc" }));
    const found = await repo.findByDoi("10.1234/abc");
    assert.equal(found?.id, "a");
  });

  test(`[${label}] delete removes the entity`, async () => {
    const repo = makeRepo();
    const paper = samplePaper();
    await repo.save(paper);
    await repo.delete(paper.id);
    assert.equal(await repo.getById(paper.id), null);
  });

  test(`[${label}] save is idempotent upsert on id`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", title: "v1" }));
    await repo.save(samplePaper({ id: "a", title: "v2" }));
    const found = await repo.getById("a");
    assert.equal(found?.title, "v2");
    const all = await repo.list();
    assert.equal(all.length, 1);
  });
}
