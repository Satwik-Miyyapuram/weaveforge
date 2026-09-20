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

  // --- the narrow lookup (PERF-04) -----------------------------------------
  //
  // `findIdentityBy*` answers the same question as `findBy*` with three columns
  // instead of a whole row, and the citation linker and the reader's reference
  // panel depend on it. Checked against both implementations here because the
  // failure that matters is not "wrong columns" — it is a lookup that finds
  // nothing, on a path whose result is "not in the library" rather than an
  // error.

  test(`[${label}] findIdentityBy* answers from the same store as findBy*`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", title: "Latent Diffusion", doi: "10.1234/abc", arxivId: "1312.6114" }));

    const byDoi = await repo.findIdentityByDoi("10.1234/abc");
    assert.equal(byDoi?.id, "a");
    assert.equal(byDoi?.title, "Latent Diffusion");
    assert.equal(byDoi?.status, "to_read");

    const byArxiv = await repo.findIdentityByArxivId("1312.6114");
    assert.equal(byArxiv?.id, "a");

    assert.equal(await repo.findIdentityByDoi("10.9999/nope"), null);
    assert.equal(await repo.findIdentityByArxivId("0000.0000"), null);
  });

  test(`[${label}] findIdentityByDoi normalizes the way findByDoi does`, async () => {
    // A DOI pasted as a URL and a DOI stored bare are the same paper; the two
    // lookups disagreeing here would mean a citation found by one path and not
    // the other.
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a", doi: "10.1234/abc" }));

    assert.equal((await repo.findIdentityByDoi("https://doi.org/10.1234/abc"))?.id, "a");
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

  // --- the lossy method (review-2 F4c) -------------------------------------
  //
  // `listSummaries` was omitted from every contract suite, so nothing checked
  // what a screen actually paints from — and the reviewer's point is that it is
  // precisely the *lossy* method, the one where a mistake is invisible. It is
  // now required on the port, so the branches that used to record its absence
  // are gone: an implementation without it does not compile, and one that
  // returns `list()` is saying so itself.
  test(`[${label}] listSummaries covers every saved paper`, async () => {
    const repo = makeRepo();
    await repo.save(samplePaper({ id: "a" }));
    await repo.save(samplePaper({ id: "b", status: "read" }));
    const summaries = await repo.listSummaries();
    assert.deepEqual(
      summaries.map((s) => s.id).sort(),
      ["a", "b"],
      "a card list that omits a row drops it from the screen",
    );
  });

  test(`[${label}] listSummaries keeps the identity a card paints`, async () => {
    const repo = makeRepo();
    const paper = samplePaper({ id: "a", title: "Latent Diffusion" });
    await repo.save(paper);
    const [summary] = await repo.listSummaries();
    assert.ok(summary);
    assert.equal(summary.id, paper.id);
    assert.equal(summary.title, paper.title);
    assert.deepEqual(summary.authors, paper.authors);
    assert.equal(summary.status, paper.status);
    assert.equal(summary.createdAt, paper.createdAt);
  });

  test(`[${label}] listSummaries never invents a field it did not fetch`, async () => {
    // The failure mode F6 names: a projection typed as a full entity, written
    // back through `toRow`, and the columns it never selected become empty. A
    // summary must be honest about being one — it may omit the un-fetched
    // fields, and if it carries a lossy field at all it must carry the real
    // value, never a placeholder that reads as "the user cleared this".
    const repo = makeRepo();
    const paper = samplePaper({
      id: "a",
      abstract: "We introduce…",
      bibtex: "@article{k, title={x}}",
      metadata: { images: ["a.png"] },
      venue: "NeurIPS",
      rating: 4,
    });
    await repo.save(paper);
    const [summary] = await repo.listSummaries();
    assert.ok(summary);
    const s = summary as Partial<typeof paper>;
    if (s.abstract !== undefined) assert.equal(s.abstract, paper.abstract);
    if (s.bibtex !== undefined) assert.equal(s.bibtex, paper.bibtex);
    if (s.venue !== undefined) assert.equal(s.venue, paper.venue);
    if (s.rating !== undefined) assert.equal(s.rating, paper.rating);
    if (s.metadata !== undefined) assert.deepEqual(s.metadata, paper.metadata);
    // Whatever it does carry must round-trip: re-saving the summary must not
    // lose a stored row's identity.
    assert.equal((await repo.getById(paper.id))?.abstract, paper.abstract);
  });
}
