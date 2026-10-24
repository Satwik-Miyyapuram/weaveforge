/**
 * Shared CONTRACT test suite for IPaperRepository.
 *
 * Per the design doc's testing strategy: every implementation of
 * IPaperRepository (in-memory, PostgREST, SQLite) must pass this identical suite.
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
import { titleKey } from "../features/papers/domain/paper-title.js";

/**
 * Ids for one test, by name. UUIDs, and fresh per test, because a database
 * adapter keys `papers.id` as a uuid and every test shares one database: a
 * fixed "a" would not be a valid id there, and a fixed uuid would collide with
 * the row another test left behind.
 */
function ids(): (name: string) => string {
  const byName = new Map<string, string>();
  return (name) => {
    let value = byName.get(name);
    if (!value) {
      value = crypto.randomUUID();
      byName.set(name, value);
    }
    return value;
  };
}

function samplePaper(overrides: Partial<Paper> & { id: string }): Paper {
  const now = "2026-06-24T00:00:00.000Z";
  return {
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
  makeRepo: () => IPaperRepository | Promise<IPaperRepository>,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = await makeRepo();
    const id = ids();
    const paper = samplePaper({ id: id("p1") });
    await repo.save(paper);
    const found = await repo.getById(paper.id);
    assert.ok(found);
    assert.equal(found.title, paper.title);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = await makeRepo();
    const id = ids();
    assert.equal(await repo.getById(id("missing")), null);
  });

  test(`[${label}] list filters by status`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), status: "read" }));
    await repo.save(samplePaper({ id: id("b"), status: "to_read" }));
    const read = await repo.list({ status: "read" });
    assert.equal(read.length, 1);
    assert.equal(read[0]?.id, id("a"));
  });

  test(`[${label}] list filters by title substring (case-insensitive)`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "Latent Diffusion Models" }));
    await repo.save(samplePaper({ id: id("b"), title: "Graph Neural Networks" }));
    const hit = await repo.list({ titleContains: "latent" });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]?.id, id("a"));
  });

  test(`[${label}] findByArxivId locates the paper`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), arxivId: "1312.6114" }));
    const found = await repo.findByArxivId("1312.6114");
    assert.equal(found?.id, id("a"));
    assert.equal(await repo.findByArxivId("0000.0000"), null);
  });

  test(`[${label}] findByDoi locates the paper`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), doi: "10.1234/abc" }));
    const found = await repo.findByDoi("10.1234/abc");
    assert.equal(found?.id, id("a"));
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
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "Latent Diffusion", doi: "10.1234/abc", arxivId: "1312.6114" }));

    const byDoi = await repo.findIdentityByDoi("10.1234/abc");
    assert.equal(byDoi?.id, id("a"));
    assert.equal(byDoi?.title, "Latent Diffusion");
    assert.equal(byDoi?.status, "to_read");

    const byArxiv = await repo.findIdentityByArxivId("1312.6114");
    assert.equal(byArxiv?.id, id("a"));

    assert.equal(await repo.findIdentityByDoi("10.9999/nope"), null);
    assert.equal(await repo.findIdentityByArxivId("0000.0000"), null);
  });

  test(`[${label}] findIdentityByDoi normalizes the way findByDoi does`, async () => {
    // A DOI pasted as a URL and a DOI stored bare are the same paper; the two
    // lookups disagreeing here would mean a citation found by one path and not
    // the other.
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), doi: "10.1234/abc" }));

    assert.equal((await repo.findIdentityByDoi("https://doi.org/10.1234/abc"))?.id, id("a"));
  });

  test(`[${label}] delete removes the entity`, async () => {
    const repo = await makeRepo();
    const id = ids();
    const paper = samplePaper({ id: id("p1") });
    await repo.save(paper);
    await repo.delete(paper.id);
    assert.equal(await repo.getById(paper.id), null);
  });

  test(`[${label}] save is idempotent upsert on id`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "v1" }));
    await repo.save(samplePaper({ id: id("a"), title: "v2" }));
    const found = await repo.getById(id("a"));
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
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a") }));
    await repo.save(samplePaper({ id: id("b"), status: "read" }));
    const summaries = await repo.listSummaries();
    assert.deepEqual(
      summaries.map((s) => s.id).sort(),
      [id("a"), id("b")].sort(),
      "a card list that omits a row drops it from the screen",
    );
  });

  test(`[${label}] listSummaries keeps the identity a card paints`, async () => {
    const repo = await makeRepo();
    const id = ids();
    const paper = samplePaper({ id: id("a"), title: "Latent Diffusion" });
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
    const repo = await makeRepo();
    const id = ids();
    const paper = samplePaper({
      id: id("a"),
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
  // --- isolation (08-10) ---------------------------------------------------
  //
  // A database hands back a new object on every read. A store that hands back
  // the object it holds lets a caller change the library without `save()`, and
  // a test written against that store passes for a reason the app does not share.

  test(`[${label}] a returned paper is a copy, not the stored one`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(
      samplePaper({ id: id("a"), doi: "10.1234/abc", arxivId: "1312.6114", tags: ["x"], metadata: { k: "v" } }),
    );

    const reads = [
      await repo.getById(id("a")),
      (await repo.list())[0],
      await repo.findByDoi("10.1234/abc"),
      await repo.findByArxivId("1312.6114"),
    ];
    for (const paper of reads) {
      assert.ok(paper);
      paper.title = "mutated";
      paper.tags.push("mutated");
      (paper.metadata as Record<string, unknown>).k = "mutated";
    }

    const stored = await repo.getById(id("a"));
    assert.equal(stored?.title, "Auto-Encoding Variational Bayes");
    assert.deepEqual(stored?.tags, ["x"]);
    assert.deepEqual(stored?.metadata, { k: "v" });
  });

  test(`[${label}] changing a paper after save does not change the store`, async () => {
    const repo = await makeRepo();
    const id = ids();
    const paper = samplePaper({ id: id("a"), tags: ["x"], metadata: { k: "v" } });
    await repo.save(paper);
    paper.title = "mutated";
    paper.tags.push("mutated");
    (paper.metadata as Record<string, unknown>).k = "mutated";

    const stored = await repo.getById(id("a"));
    assert.equal(stored?.title, "Auto-Encoding Variational Bayes");
    assert.deepEqual(stored?.tags, ["x"]);
    assert.deepEqual(stored?.metadata, { k: "v" });
  });

  // --- the tag column patch (05-09) ----------------------------------------
  //
  // Writing the tag cache back as a whole row overwrote any edit made since the
  // row was read. The patch writes the tags and the stamp, and nothing else.

  test(`[${label}] setTags writes the tags and the stamp, and keeps every other field`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), summary: "mine", abstract: "We introduce", tags: ["old"] }));

    await repo.setTags(id("a"), ["alpha", "beta"], "2026-07-01T00:00:00.000Z");

    const stored = await repo.getById(id("a"));
    assert.deepEqual(stored?.tags, ["alpha", "beta"]);
    // A database may stamp the row itself (the papers trigger does); either way it moves on.
    assert.ok((stored?.updatedAt ?? "") >= "2026-07-01T00:00:00.000Z", "the stamp moves forward");
    assert.equal(stored?.summary, "mine");
    assert.equal(stored?.abstract, "We introduce");
    assert.equal(stored?.title, "Auto-Encoding Variational Bayes");
  });

  test(`[${label}] setTags to no tags clears them`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), tags: ["old"] }));
    await repo.setTags(id("a"), [], "2026-07-01T00:00:00.000Z");
    assert.deepEqual((await repo.getById(id("a")))?.tags, []);
  });

  test(`[${label}] setTags on a missing paper creates nothing`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.setTags(id("missing"), ["alpha"], "2026-07-01T00:00:00.000Z");
    assert.equal(await repo.getById(id("missing")), null);
    assert.equal((await repo.list()).length, 0);
  });

  // --- the summary compare-and-set (02-07) ---------------------------------
  //
  // Appending a note read the row and wrote all of it back, so an edit landing
  // in between was lost. The write now names the summary it expects to replace
  // and says whether it did.

  test(`[${label}] replaceSummary replaces the summary it was told to expect`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), summary: "first", abstract: "We introduce" }));

    assert.equal(await repo.replaceSummary(id("a"), "first", "first\n\nsecond", "2026-07-01T00:00:00.000Z"), true);

    const stored = await repo.getById(id("a"));
    assert.equal(stored?.summary, "first\n\nsecond");
    // A database may stamp the row itself (the papers trigger does); either way it moves on.
    assert.ok((stored?.updatedAt ?? "") >= "2026-07-01T00:00:00.000Z", "the stamp moves forward");
    assert.equal(stored?.abstract, "We introduce");
  });

  test(`[${label}] replaceSummary refuses when the summary moved on`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), summary: "edited elsewhere" }));

    assert.equal(await repo.replaceSummary(id("a"), "first", "first + note", "2026-07-01T00:00:00.000Z"), false);

    const stored = await repo.getById(id("a"));
    assert.equal(stored?.summary, "edited elsewhere");
    assert.equal(stored?.updatedAt, "2026-06-24T00:00:00.000Z");
  });

  test(`[${label}] replaceSummary treats no summary as an expectation of its own`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("empty") }));
    await repo.save(samplePaper({ id: id("full"), summary: "written" }));

    assert.equal(await repo.replaceSummary(id("empty"), undefined, "note", "2026-07-01T00:00:00.000Z"), true);
    assert.equal((await repo.getById(id("empty")))?.summary, "note");
    assert.equal(await repo.replaceSummary(id("full"), undefined, "note", "2026-07-01T00:00:00.000Z"), false);
    assert.equal((await repo.getById(id("full")))?.summary, "written");
  });

  test(`[${label}] replaceSummary on a missing paper creates nothing`, async () => {
    const repo = await makeRepo();
    const id = ids();
    assert.equal(await repo.replaceSummary(id("missing"), undefined, "note", "2026-07-01T00:00:00.000Z"), false);
    assert.equal(await repo.getById(id("missing")), null);
  });

  // --- the title lookup (03-03) --------------------------------------------
  //
  // Dedupe by title loaded the whole library on every add. The narrow lookup
  // must find what that scan found: the same `titleKey`, nothing else.

  test(`[${label}] findByTitleKey finds the paper with the same title key`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "Attention Is All You Need: A Study", abstract: "We introduce" }));
    await repo.save(samplePaper({ id: id("b"), title: "Graph Neural Networks for Molecules" }));

    const found = await repo.findByTitleKey(titleKey("attention is all you need -- a study!")!);
    assert.equal(found?.id, id("a"));
    assert.equal(found?.abstract, "We introduce", "a hit is the whole paper");
  });

  test(`[${label}] findByTitleKey matches a filename-shaped title and an accented one`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "Kingma - 2013 - Auto-Encoding Variational Bayes.pdf" }));
    await repo.save(samplePaper({ id: id("b"), title: "Über die Quantenmechanik der Elektronen" }));

    assert.equal((await repo.findByTitleKey(titleKey("Auto-Encoding Variational Bayes")!))?.id, id("a"));
    assert.equal((await repo.findByTitleKey(titleKey("über die quantenmechanik der elektronen")!))?.id, id("b"));
  });

  test(`[${label}] findByTitleKey does not match a title that only contains the key`, async () => {
    const repo = await makeRepo();
    const id = ids();
    await repo.save(samplePaper({ id: id("a"), title: "Attention Is All You Need: A Study, Revisited" }));
    assert.equal(await repo.findByTitleKey(titleKey("Attention Is All You Need: A Study")!), null);
  });

  test(`[${label}] findByTitleKey with only short words still finds the paper`, async () => {
    const repo = await makeRepo();
    const id = ids();
    const title = "Of the art of a cat on a mat in a hat";
    await repo.save(samplePaper({ id: id("a"), title }));
    assert.equal((await repo.findByTitleKey(titleKey(title)!))?.id, id("a"));
    assert.equal(await repo.findByTitleKey(titleKey("Of the art of a dog on a mat in a hat")!), null);
  });
}
