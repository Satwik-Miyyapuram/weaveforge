import { emptyWorkspaceSnapshot as snapshot } from "@weaveforge/core/testing";
import assert from "node:assert/strict";
import test from "node:test";
import { searchRevision, toPdfSearchDocs, toSearchDocs, type SearchDoc, type WorkspaceSnapshot } from "@weaveforge/core";
import { SEARCH_SCHEMA_VERSION, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";

const note = (id: string, title: string, body = "") =>
  ({
    id,
    title,
    body,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }) as never;

function corpus(): SearchDoc[] {
  return toSearchDocs(
    snapshot({
      vaultPages: [
        note("n1", "Variational Autoencoders", "Latent variable models with an #vae encoder."),
        note("n2", "Graph Neural Networks", "Message passing over graphs."),
        note("n3", "Meeting notes", "Discussed the autoencoder baseline with the supervisor."),
      ],
      papers: [
        {
          id: "p1",
          title: "Attention Is All You Need",
          authors: ["Vaswani"],
          venue: "NeurIPS",
          year: 2017,
          abstract: "The dominant sequence transduction models use recurrence.",
          summary: "",
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
    }),
  );
}

function index(docs = corpus()) {
  return buildSearchIndex(docs, searchRevision(docs));
}

test("finds a note by a word in its body — impossible with title substring matching", () => {
  const hits = index().search("message passing");

  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.entityId, "n2");
});

test("ranks a title match above a body mention of the same word", () => {
  const hits = index().search("autoencoders");

  // n1 has it in the title, n3 only in prose.
  assert.equal(hits[0]!.entityId, "n1");
});

test("tolerates a typo in a long term", () => {
  const hits = index().search("attension");

  assert.ok(
    hits.some((hit) => hit.entityId === "p1"),
    "a one-edit typo in a long term should still match",
  );
});

test("does not fuzzy-match short terms into noise", () => {
  const hits = index().search("vae");

  assert.ok(hits.every((hit) => hit.kind === "note" || hit.kind === "paper"));
  assert.ok(hits.some((hit) => hit.entityId === "n1"), "the hashtag should still match exactly");
});

test("matches on a prefix", () => {
  const hits = index().search("neur");

  assert.ok(hits.length > 0, "a three-character prefix should match");
});

test("finds a paper by author, which is indexed as an alias", () => {
  const hits = index().search("Vaswani");

  assert.equal(hits[0]!.entityId, "p1");
});

test("filters by kind", () => {
  const hits = index().search("a", { kinds: ["paper"] });

  assert.ok(hits.every((hit) => hit.kind === "paper"));
});

test("respects the result limit", () => {
  assert.ok(index().search("a", { limit: 2 }).length <= 2);
});

test("an empty query returns nothing rather than everything", () => {
  assert.deepEqual(index().search("   "), []);
});

test("hits carry the route so results are navigable", () => {
  const hit = index().search("Graph Neural")[0]!;

  assert.equal(hit.href, "/notes?page=n2");
  assert.ok(hit.terms.length > 0, "matched terms are needed for highlighting");
});

test("serialize/load round-trips and keeps returning the same top hit", () => {
  const docs = corpus();
  const revision = searchRevision(docs);
  const original = buildSearchIndex(docs, revision);

  const restored = miniSearchIndexFactory.load(original.serialize(), revision);

  assert.ok(restored, "a matching revision should rehydrate");
  assert.equal(restored!.search("message passing")[0]!.entityId, "n2");
});

test("a stale revision is rejected so deleted documents cannot be served", () => {
  const docs = corpus();
  const serialized = buildSearchIndex(docs, searchRevision(docs)).serialize();

  const shorter = docs.slice(0, 2);
  assert.equal(miniSearchIndexFactory.load(serialized, searchRevision(shorter)), null);
});

test("a payload from another schema version is rejected", () => {
  const docs = corpus();
  const revision = searchRevision(docs);
  const payload = JSON.parse(buildSearchIndex(docs, revision).serialize());
  payload.schemaVersion = SEARCH_SCHEMA_VERSION + 1;

  assert.equal(miniSearchIndexFactory.load(JSON.stringify(payload), revision), null);
});

test("malformed cached JSON rebuilds instead of throwing", () => {
  assert.equal(miniSearchIndexFactory.load("{not json", "1:x"), null);
  assert.equal(miniSearchIndexFactory.load("{}", "1:x"), null);
});

test("incremental add and remove update results", () => {
  const idx = index();

  idx.add([
    {
      id: "note:n4",
      kind: "note",
      entityId: "n4",
      title: "Diffusion models",
      aliases: [],
      headings: [],
      tags: [],
      path: "",
      body: "Score matching.",
      updatedAt: "2026-03-01T00:00:00.000Z",
      href: "/notes?page=n4",
      degree: 0,
    },
  ]);
  assert.equal(idx.search("diffusion")[0]!.entityId, "n4");

  idx.remove(["note:n4"]);
  assert.deepEqual(idx.search("diffusion"), []);
});

test("re-adding an existing id replaces rather than throwing", () => {
  const docs = corpus();
  const idx = index(docs);

  assert.doesNotThrow(() => idx.add([{ ...docs[0]!, title: "Renamed VAE note" }]));
  assert.equal(idx.search("Renamed")[0]!.entityId, "n1");
});

test("a well-linked document outranks an unlinked one on an equal match", () => {
  const base = toSearchDocs(
    snapshot({ vaultPages: [note("a", "Baseline"), note("b", "Baseline")] }),
  );
  const docs = base.map((doc) => (doc.entityId === "b" ? { ...doc, degree: 12 } : doc));

  const hits = buildSearchIndex(docs, searchRevision(docs)).search("baseline");

  assert.equal(hits[0]!.entityId, "b", "link degree should break an otherwise equal tie");
});

// ------------------------------------------------------- query syntax (Phase 2)

test("kind: restricts results to that entity kind", () => {
  const hits = index().search("kind:paper");

  assert.ok(hits.length > 0);
  assert.ok(hits.every((hit) => hit.kind === "paper"));
});

test("a caller's kinds are intersected with kind:, never widened by it", () => {
  // A notes screen must not start showing papers because the user typed
  // kind:paper into its filter box.
  const hits = index().search("kind:paper", { kinds: ["note"] });

  assert.deepEqual(hits, []);
});

test("tag: filters on indexed tags", () => {
  const hits = index().search("tag:vae");

  assert.ok(hits.length > 0);
  assert.ok(hits.every((hit) => hit.entityId === "n1"));
});

test("exclusions remove otherwise-matching documents", () => {
  const withAll = index().search("models");
  const without = index().search("models -recurrence");

  assert.ok(withAll.some((hit) => hit.entityId === "p1"));
  assert.ok(!without.some((hit) => hit.entityId === "p1"), "the excluded term should drop the paper");
});

test("a quoted phrase requires adjacency, not just both words", () => {
  const loose = index().search("passing message");
  const phrase = index().search('"message passing"');

  assert.ok(loose.some((hit) => hit.entityId === "n2"));
  assert.ok(phrase.some((hit) => hit.entityId === "n2"));
  assert.ok(
    !phrase.some((hit) => hit.entityId === "n1"),
    "a document with neither adjacency nor the words should not match",
  );
});

test("diacritics fold, so an unaccented query finds accented text", () => {
  const docs = toSearchDocs(snapshot({ vaultPages: [note("d1", "Café notes", "Réunion at the café.")] }));
  const hits = buildSearchIndex(docs, searchRevision(docs)).search("cafe");

  assert.equal(hits[0]!.entityId, "d1");
});

test("CJK queries match without whitespace segmentation", () => {
  const docs = toSearchDocs(snapshot({ vaultPages: [note("c1", "变分自编码器", "变分自编码器的实现")] }));
  const hits = buildSearchIndex(docs, searchRevision(docs)).search("编码");

  assert.equal(hits[0]!.entityId, "c1");
});

test("camelCase text is findable by its parts", () => {
  const docs = toSearchDocs(snapshot({ vaultPages: [note("k1", "Code", "call parseHTTPResponse here")] }));
  const hits = buildSearchIndex(docs, searchRevision(docs)).search("response");

  assert.equal(hits[0]!.entityId, "k1");
});

test("a filter-only query still returns results", () => {
  const hits = index().search("kind:note");

  assert.ok(hits.length >= 3, "kind:note alone should enumerate the notes");
  assert.ok(hits.every((hit) => hit.kind === "note"));
});

test("an unknown kind: narrows to nothing rather than matching everything", () => {
  assert.deepEqual(index().search("kind:banana"), []);
});

// ---------------------------------------------------- user settings (Phase 3)

test("field weights are user-tunable and change the ranking", () => {
  const docs = toSearchDocs(
    snapshot({
      vaultPages: [
        note("t1", "latent", "unrelated prose"),
        note("t2", "Unrelated title", "latent latent latent"),
      ],
    }),
  );
  const revision = searchRevision(docs);

  const byDefault = buildSearchIndex(docs, revision).search("latent");
  assert.equal(byDefault[0]!.entityId, "t1", "title normally wins");

  const bodyHeavy = buildSearchIndex(docs, revision, {
    weights: { title: 1, body: 20 },
  }).search("latent");
  assert.equal(bodyHeavy[0]!.entityId, "t2", "raising the body weight should flip it");
});

test("a downranked kind sinks but is not removed", () => {
  const docs = toSearchDocs(
    snapshot({
      vaultPages: [note("n9", "Baseline")],
      papers: [
        {
          id: "p9", title: "Baseline", authors: [], tags: [],
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        } as never,
      ],
    }),
  );
  const revision = searchRevision(docs);

  const sunk = buildSearchIndex(docs, revision, { downrankedKinds: ["note"] }).search("baseline");

  assert.ok(sunk.some((hit) => hit.kind === "note"), "downranking must not exclude");
  assert.equal(sunk[0]!.kind, "paper", "the downranked kind should sort below");
});

test("excerpts are opt-in and highlight the matched terms", () => {
  const without = index().search("message passing")[0]!;
  assert.equal(without.excerpt, undefined, "excerpts cost a scan, so they are off by default");

  const hit = index().search("message passing", { excerpts: true })[0]!;
  assert.ok(hit.excerpt);
  assert.ok(hit.excerpt!.highlights.length > 0);
  assert.match(hit.excerpt!.text, /Message passing/i);
});

// ------------------------------------------------------ PDF pages (Phase 4)

function pdfDocs() {
  return toPdfSearchDocs([
    {
      paperId: "p1",
      title: "Attention Is All You Need",
      extractedAt: "2026-08-05T00:00:00.000Z",
      pages: [
        { pageIndex: 0, text: "The dominant sequence transduction models use recurrence." },
        { pageIndex: 11, text: "Scaled dot product attention computes the compatibility function." },
      ],
    },
  ]);
}

test("PDF page text is searchable and reports the page", () => {
  const docs = [...corpus(), ...pdfDocs()];
  const hits = buildSearchIndex(docs, searchRevision(docs)).search("dot product");

  assert.equal(hits[0]!.kind, "pdf");
  assert.equal(hits[0]!.page, 11);
  assert.equal(hits[0]!.href, "/reader?paper=p1&page=11");
});

test("PDF hits can be filtered out like any other kind", () => {
  const docs = [...corpus(), ...pdfDocs()];
  const index = buildSearchIndex(docs, searchRevision(docs));

  assert.ok(index.search("kind:pdf").every((hit) => hit.kind === "pdf"));
  assert.ok(index.search("recurrence", { kinds: ["paper"] }).every((hit) => hit.kind !== "pdf"));
});

test("a PDF page survives the cache round-trip with its page number", () => {
  const docs = [...corpus(), ...pdfDocs()];
  const revision = searchRevision(docs);
  const restored = miniSearchIndexFactory.load(
    buildSearchIndex(docs, revision).serialize(),
    revision,
  );

  assert.equal(restored!.search("dot product")[0]!.page, 11);
});
