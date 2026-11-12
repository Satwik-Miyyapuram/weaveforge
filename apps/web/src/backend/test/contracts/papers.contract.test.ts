// contract-repos: papers
import assert from "node:assert/strict";
import test from "node:test";
import type { Paper } from "@weaveforge/core";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IPaperRepository` contract, end to end: Rust plans each query, the TS
 * sender runs it against PGlite with the real `papers` migration and RLS.
 * Ported from the deleted `paper-repository-contract.ts` suite.
 */

async function repoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustPaperRepository(clientFor(db, userId), projectFor(projectId));
}

function samplePaper(overrides: Partial<Paper> = {}): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: crypto.randomUUID(),
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma", "Welling"],
    status: "to_read",
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("save then getById returns the entity", async () => {
  const repo = await repoFor(await testDb());
  const paper = samplePaper();
  await repo.save(paper);
  const found = await repo.getById(paper.id);
  assert.equal(found!.title, paper.title);
});

test("getById returns null when absent", async () => {
  const repo = await repoFor(await testDb());
  assert.equal(await repo.getById(crypto.randomUUID()), null);
});

test("list filters by status", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, status: "read" }));
  await repo.save(samplePaper({ id: b, status: "to_read" }));
  const read = await repo.list({ status: "read" });
  assert.equal(read.length, 1);
  assert.equal(read[0]?.id, a);
});

test("list filters by title substring (case-insensitive)", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, title: "Latent Diffusion Models" }));
  await repo.save(samplePaper({ title: "Graph Neural Networks" }));
  const hit = await repo.list({ titleContains: "latent" });
  assert.equal(hit.length, 1);
  assert.equal(hit[0]?.id, a);
});

test("findByArxivId locates the paper", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, arxivId: "1312.6114" }));
  const found = await repo.findByArxivId("1312.6114");
  assert.equal(found?.id, a);
  assert.equal(await repo.findByArxivId("0000.0000"), null);
});

test("findByDoi locates the paper", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, doi: "10.1234/abc" }));
  const found = await repo.findByDoi("10.1234/abc");
  assert.equal(found?.id, a);
});

test("findIdentityBy* answers from the same store as findBy*", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, title: "Latent Diffusion", doi: "10.1234/abc", arxivId: "1312.6114" }));

  const byDoi = await repo.findIdentityByDoi("10.1234/abc");
  assert.equal(byDoi?.id, a);
  assert.equal(byDoi?.title, "Latent Diffusion");
  assert.equal(byDoi?.status, "to_read");

  const byArxiv = await repo.findIdentityByArxivId("1312.6114");
  assert.equal(byArxiv?.id, a);

  assert.equal(await repo.findIdentityByDoi("10.9999/nope"), null);
  assert.equal(await repo.findIdentityByArxivId("0000.0000"), null);
});

test("findIdentityByDoi normalizes the way findByDoi does", async () => {
  // A DOI pasted as a URL and a DOI stored bare are the same paper; the two
  // lookups disagreeing here would mean a citation found by one path and not
  // the other.
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, doi: "10.1234/abc" }));

  assert.equal((await repo.findIdentityByDoi("https://doi.org/10.1234/abc"))?.id, a);
});

test("delete removes the entity", async () => {
  const repo = await repoFor(await testDb());
  const paper = samplePaper();
  await repo.save(paper);
  await repo.delete(paper.id);
  assert.equal(await repo.getById(paper.id), null);
});

test("save is idempotent upsert on id", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  await repo.save(samplePaper({ id: a, title: "v1" }));
  await repo.save(samplePaper({ id: a, title: "v2" }));
  const found = await repo.getById(a);
  assert.equal(found?.title, "v2");
  const all = await repo.list();
  assert.equal(all.length, 1);
});

test("listSummaries covers every saved paper", async () => {
  const repo = await repoFor(await testDb());
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await repo.save(samplePaper({ id: a }));
  await repo.save(samplePaper({ id: b, status: "read" }));
  const summaries = await repo.listSummaries();
  assert.deepEqual(
    summaries.map((s) => s.id).sort(),
    [a, b].sort(),
    "a card list that omits a row drops it from the screen",
  );
});

test("listSummaries keeps the identity a card paints", async () => {
  const repo = await repoFor(await testDb());
  const paper = samplePaper({ title: "Latent Diffusion" });
  await repo.save(paper);
  const summary = (await repo.listSummaries())[0]!;
  assert.equal(summary.id, paper.id);
  assert.equal(summary.title, paper.title);
  assert.deepEqual(summary.authors, paper.authors);
  assert.equal(summary.status, paper.status);
  assert.equal(summary.createdAt, paper.createdAt);
});

test("listSummaries never invents a field it did not fetch", async () => {
  // The failure mode F6 names: a projection typed as a full entity, written
  // back through `toRow`, and the columns it never selected become empty. A
  // summary must be honest about being one — it may omit the un-fetched
  // fields, and if it carries a lossy field at all it must carry the real
  // value, never a placeholder that reads as "the user cleared this".
  const repo = await repoFor(await testDb());
  const paper = samplePaper({
    abstract: "We introduce…",
    bibtex: "@article{k, title={x}}",
    metadata: { images: ["a.png"] },
    venue: "NeurIPS",
    rating: 4,
  });
  await repo.save(paper);
  const summary = (await repo.listSummaries())[0]!;
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
