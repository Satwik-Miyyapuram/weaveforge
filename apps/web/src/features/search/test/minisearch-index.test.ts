import assert from "node:assert/strict";
import test from "node:test";
import { searchRevision, toSearchDocs, type SearchDoc, type WorkspaceSnapshot } from "@thesis/core";
import { SEARCH_SCHEMA_VERSION, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";

function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    papers: [],
    vaultPages: [],
    readingLists: [],
    readingListItems: [],
    reportSections: [],
    experiments: [],
    milestones: [],
    logEntries: [],
    relations: [],
    tags: [],
    collectedAt: "2026-08-05T00:00:00.000Z",
    ...over,
  };
}

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
