import { emptyWorkspaceSnapshot as snapshot } from "@weaveforge/core/testing";
import assert from "node:assert/strict";
import test from "node:test";
import type { PdfIndexSource, SearchHit, WorkspaceSnapshot } from "@weaveforge/core";
import { WorkspaceSearch } from "@/features/search/application/workspace-search";
import { collapseToEntities, distinctRelated } from "@/features/search/application/collapse-to-entities";

/**
 * `WorkspaceSearch` reaches IndexedDB for the PDF text store and the index
 * cache. Neither exists here, and both are written to fail soft, so the class
 * behaves as it would on a device with storage disabled — which is exactly the
 * surface these tests are about.
 */

const paper = (id: string, title: string) =>
  ({
    id,
    title,
    authors: [],
    status: "to_read",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }) as unknown as WorkspaceSnapshot["papers"][number];

const note = (id: string, title: string, body: string) =>
  ({
    id,
    title,
    body,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }) as unknown as WorkspaceSnapshot["vaultPages"][number];

function pdf(paperId: string, pages: string[]): PdfIndexSource {
  return {
    paperId,
    title: `Paper ${paperId}`,
    pages: pages.map((text, pageIndex) => ({ pageIndex, text })),
    extractedAt: "2026-03-01T00:00:00.000Z",
  };
}

function searchFor(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSearch {
  return new WorkspaceSearch({
    snapshot: async () => snapshot(over),
    projectId: () => "p1",
  });
}

const LONG = (word: string) => `${word} `.repeat(60);

test("a PDF read in the reader is searchable without a rebuild", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();
  assert.equal(search.search("photosynthesis").length, 0);

  search.indexPdf(pdf("pa1", [LONG("photosynthesis")]));

  const hits = search.search("photosynthesis");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.kind, "pdf");
  assert.match(hits[0]!.href, /page=0/);
});

test("re-extracting a PDF replaces its pages rather than accumulating them", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();

  search.indexPdf(pdf("pa1", [LONG("chlorophyll"), LONG("chlorophyll")]));
  assert.equal(search.search("chlorophyll").length, 2);

  // A shorter second pass: the page that is gone must go with it.
  search.indexPdf(pdf("pa1", [LONG("chlorophyll")]));
  assert.equal(search.search("chlorophyll").length, 1);
});

test("a re-extraction that finds nothing leaves nothing behind", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();

  search.indexPdf(pdf("pa1", [LONG("mitochondria")]));
  assert.equal(search.search("mitochondria").length, 1);

  search.indexPdf(pdf("pa1", []));
  assert.equal(search.search("mitochondria").length, 0);
});

test("the indexed count tracks pages as they come and go", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();
  const base = search.corpusSize.documents;

  search.indexPdf(pdf("pa1", [LONG("alpha"), LONG("beta")]));
  assert.equal(search.corpusSize.documents, base + 2);

  search.indexPdf(pdf("pa1", [LONG("alpha")]));
  assert.equal(search.corpusSize.documents, base + 1);
});

test("indexing before the index exists is a no-op, not a crash", () => {
  const search = searchFor();
  search.indexPdf(pdf("pa1", [LONG("gamma")]));
  assert.equal(search.ready, false);
});

test("invalidating forgets what was held per paper", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();
  search.indexPdf(pdf("pa1", [LONG("delta")]));

  search.invalidate();
  assert.equal(search.ready, false);
  assert.equal(search.corpusSize.documents, 0);
});

// --- what the semantic arm embeds -------------------------------------------
//
// The projection the index was built from used to be kept for this arm, and it
// went stale the moment anything was refreshed: `refreshStale` and `indexPdf`
// add documents and neither touched the copy. Because the vector store's
// revision is derived from this projection, a stale copy meant a note added
// after the build could never be found semantically — and nothing said so.

test("the semantic corpus includes a note added after the build", async () => {
  const pages = [note("n1", "Method", "The GAN setup.")];
  const search = new WorkspaceSearch({
    snapshot: async () => snapshot({ vaultPages: [...pages] }),
    projectId: () => "p1",
  });

  await search.ensure();
  const before = await search.projectionForSemantic();
  assert.deepEqual(
    before.filter((doc) => doc.kind === "note").map((doc) => doc.id),
    ["note:n1"],
  );

  pages.push(note("n2", "Results", "The diffusion sampler."));
  search.markStale("vault_page");
  await search.ensure();

  const after = await search.projectionForSemantic();
  assert.deepEqual(
    after.filter((doc) => doc.kind === "note").map((doc) => doc.id).sort(),
    ["note:n1", "note:n2"],
    "a note added since the build has to be in the corpus the arm embeds",
  );
});

test("the semantic corpus is projected again after the arm is switched off", async () => {
  // Re-enabling used to be the audit's trap: clearing the retained copy on
  // disable left nothing to embed, because `ensure()` returns the existing index
  // without rebuilding. Projecting on demand is what makes the second enable
  // work.
  const search = searchFor({ vaultPages: [note("n1", "Method", "The GAN setup.")] });
  await search.ensure();

  search.setSemanticIndex(null);

  const corpus = await search.projectionForSemantic();
  assert.ok(corpus.length > 0, "there is still a corpus to embed");
});

test("a PDF indexed in the reader joins the semantic corpus too", async () => {
  const search = searchFor({ papers: [paper("pa1", "Attention")] });
  await search.ensure();
  search.indexPdf(pdf("pa1", [LONG("photosynthesis")]));

  const corpus = await search.projectionForSemantic();

  assert.ok(
    corpus.some((doc) => doc.kind === "pdf"),
    "text indexed after the build must be reproducible from the projection",
  );
});

test("a failed refresh keeps the kinds stale instead of losing them", async () => {
  // The staleness set used to be cleared *before* the snapshot was awaited, so a
  // read that rejected lost the kinds for good: the index went on serving the
  // rows it had, nothing was marked stale any more, and no later `ensure()` had
  // any reason to look again. Silent, and stale forever.
  const pages = [note("n1", "Method", "The GAN setup.")];
  let failNext = false;
  const search = new WorkspaceSearch({
    snapshot: async () => {
      if (failNext) {
        failNext = false;
        throw new Error("offline");
      }
      return snapshot({ vaultPages: [...pages] });
    },
    projectId: () => "p1",
  });

  await search.ensure();
  assert.equal(search.search("diffusion").length, 0);

  pages[0] = note("n1", "Method", "The diffusion setup.");
  search.markStale("vault_page");
  failNext = true;
  await assert.rejects(() => search.ensure(), /offline/);

  // The next attempt has to still know that notes are stale.
  await search.ensure();

  assert.equal(
    search.search("diffusion").length,
    1,
    "the kind stayed marked, so the retry actually refreshed it",
  );
});

test("editing a note refreshes notes without re-reading PDF text", async () => {
  let snapshots = 0;
  const pages = [note("n1", "Method", "The GAN setup.")];
  const search = new WorkspaceSearch({
    snapshot: async () => {
      snapshots += 1;
      return snapshot({ vaultPages: pages, papers: [paper("pa1", "Attention")] });
    },
    projectId: () => "p1",
  });

  await search.ensure();
  search.indexPdf(pdf("pa1", [LONG("photosynthesis")]));
  assert.equal(search.search("photosynthesis").length, 1);

  pages[0] = note("n1", "Method", "The diffusion setup.");
  search.markStale("vault_page");
  await search.ensure();

  assert.equal(search.search("diffusion").length, 1, "the edit is searchable");
  assert.equal(search.search("GAN").length, 0, "the old text is gone");
  assert.equal(
    search.search("photosynthesis").length,
    1,
    "PDF pages survive a note edit — they were never re-read",
  );
  assert.equal(snapshots, 2, "one read for the build, one for the refresh");
});

test("a deleted note stops answering queries", async () => {
  let pages = [note("n1", "Method", "The GAN setup."), note("n2", "Results", "Numbers here.")];
  const search = new WorkspaceSearch({
    snapshot: async () => snapshot({ vaultPages: pages }),
    projectId: () => "p1",
  });

  await search.ensure();
  assert.equal(search.search("GAN").length, 1);

  pages = pages.slice(1);
  search.markStale("vault_page");
  await search.ensure();
  assert.equal(search.search("GAN").length, 0, "a document with no replacement must be retracted");
  assert.equal(search.search("Numbers").length, 1, "its sibling is untouched");
});

test("a burst of writes costs one refresh", async () => {
  let snapshots = 0;
  const search = new WorkspaceSearch({
    snapshot: async () => {
      snapshots += 1;
      return snapshot({ vaultPages: [note("n1", "Method", "text")] });
    },
    projectId: () => "p1",
  });

  await search.ensure();
  for (let i = 0; i < 10; i += 1) search.markStale("vault_page");
  await search.ensure();

  assert.equal(snapshots, 2, "marking is cheap; the work happens once, on demand");
});

test("a write that cannot change an indexed field does no work", async () => {
  let snapshots = 0;
  const search = new WorkspaceSearch({
    snapshot: async () => {
      snapshots += 1;
      return snapshot({ vaultPages: [note("n1", "Method", "text")] });
    },
    projectId: () => "p1",
  });

  await search.ensure();
  search.markStale("comment");
  search.markStale("dashboard_layout");
  await search.ensure();

  assert.equal(snapshots, 1, "no kind is stale, so nothing is re-read");
});

test("an unmapped write distrusts the index rather than guessing", async () => {
  const search = new WorkspaceSearch({
    snapshot: async () => snapshot({ vaultPages: [note("n1", "Method", "text")] }),
    projectId: () => "p1",
  });

  await search.ensure();
  assert.equal(search.ready, true);
  search.markStale("something_new");
  assert.equal(search.ready, false, "a full rebuild is the safe answer to an unknown write");
});

test("editing a paper leaves notes alone", async () => {
  const papers = [paper("pa1", "Attention")];
  const search = new WorkspaceSearch({
    snapshot: async () => snapshot({ papers, vaultPages: [note("n1", "Method", "The GAN setup.")] }),
    projectId: () => "p1",
  });

  await search.ensure();
  const before = search.corpusSize.documents;

  search.markStale("paper");
  await search.ensure();

  assert.equal(search.corpusSize.documents, before, "count is unchanged by a no-op refresh");
  assert.equal(search.search("GAN").length, 1, "the note is still there");
});

// ------------------------------------------------- hybrid keyword + semantic

/** A semantic arm that returns a fixed ranking, standing in for the encoder. */
function fakeSemantic(ranking: readonly string[]) {
  return {
    ready: true,
    async search(_query: string, _limit: number) {
      return ranking.map((id, i) => ({ id, score: 1 - i * 0.1 }));
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex;
}

test("without a semantic arm, hybrid search is exactly the keyword ranking", async () => {
  const search = searchFor({
    vaultPages: [note("n1", "Attention", "positions"), note("n2", "Other", "unrelated")],
  });
  await search.ensure();

  const keyword = search.search("attention", { limit: 10 });
  const hybrid = await search.searchHybrid("attention", { limit: 10 });
  assert.deepEqual(hybrid.map((h) => h.id), keyword.map((h) => h.id));
});

test("a document only the semantic arm found still reaches the results", async () => {
  const search = searchFor({
    vaultPages: [
      note("n1", "Attention", "attention over positions"),
      note("n2", "Latents", "the posterior stays close to the prior"),
    ],
  });
  await search.ensure();
  assert.equal(search.search("attention").some((h) => h.id === "note:n2"), false);

  search.setSemanticIndex(fakeSemantic(["note:n2"]));
  const hybrid = await search.searchHybrid("attention", { limit: 10 });

  assert.ok(hybrid.some((h) => h.id === "note:n2"), "the vector arm contributes its own find");
  assert.ok(hybrid.some((h) => h.id === "note:n1"), "the keyword arm keeps its own");
});

test("a document both arms rank leads the fused list", async () => {
  const search = searchFor({
    vaultPages: [
      note("n1", "Sideline", "attention"),
      note("n2", "Centre", "attention attention attention"),
    ],
  });
  await search.ensure();

  search.setSemanticIndex(fakeSemantic(["note:n1"]));
  const hybrid = await search.searchHybrid("attention", { limit: 10 });
  assert.equal(hybrid[0]!.id, "note:n1", "second on keywords but first on meaning wins");
});

test("a semantic hit for a document the index no longer holds is dropped", async () => {
  const search = searchFor({ vaultPages: [note("n1", "Attention", "attention")] });
  await search.ensure();

  search.setSemanticIndex(fakeSemantic(["note:deleted"]));
  const hybrid = await search.searchHybrid("attention", { limit: 10 });

  assert.equal(hybrid.some((h) => h.id === "note:deleted"), false, "a stale vector renders nothing");
  assert.equal(hybrid.length, 1);
});

test("an encoder failure falls back to keywords rather than to nothing", async () => {
  const search = searchFor({ vaultPages: [note("n1", "Attention", "attention")] });
  await search.ensure();

  search.setSemanticIndex({
    ready: true,
    async search() {
      throw new Error("the model died");
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  const hybrid = await search.searchHybrid("attention", { limit: 10 });
  assert.equal(hybrid.length, 1, "the arm that always works still answers");
});

test("detaching the semantic arm restores keyword-only results", async () => {
  const search = searchFor({ vaultPages: [note("n1", "Attention", "attention")] });
  await search.ensure();

  search.setSemanticIndex(fakeSemantic(["note:n1"]));
  assert.equal(search.semanticReady, true);

  search.setSemanticIndex(null);
  assert.equal(search.semanticReady, false);
  assert.deepEqual(
    (await search.searchHybrid("attention", { limit: 10 })).map((h) => h.id),
    search.search("attention", { limit: 10 }).map((h) => h.id),
  );
});

test("collapseToEntities folds a paper's pages onto the paper and drops the seed", () => {
  const hit = (id: string, kind: "paper" | "pdf", entityId: string, score: number) =>
    ({ id, kind, entityId, score, title: entityId, href: "/", terms: [] }) as const;
  const folded = collapseToEntities(
    [
      hit("pdf:seed#0", "pdf", "seed", 9),
      hit("pdf:a#3", "pdf", "a", 5),
      hit("pdf:a#1", "pdf", "a", 4),
      hit("paper:b", "paper", "b", 3),
      hit("paper:a", "paper", "a", 2),
      hit("pdf:b#0", "pdf", "b", 6),
    ],
    { entityId: "seed" },
  );
  // One row per entity, linked to the entity's own document, ranked by the
  // best score any of its documents earned.
  assert.deepEqual(folded, [
    { id: "paper:b", score: 6 },
    { id: "paper:a", score: 5 },
  ]);
});

test("collapseToEntities keeps the best page when the paper itself is not indexed", () => {
  const hit = (id: string, entityId: string, score: number) =>
    ({ id, kind: "pdf" as const, entityId, score, title: entityId, href: "/", terms: [] }) as const;
  const folded = collapseToEntities([hit("pdf:a#2", "a", 1), hit("pdf:a#0", "a", 7)], { entityId: "x" });
  assert.deepEqual(folded, [{ id: "pdf:a#2", score: 7 }]);
});

test("collapseToEntities sends a page to its paper's document even when the paper did not match", () => {
  const hit = (id: string, entityId: string, score: number) =>
    ({ id, kind: "pdf" as const, entityId, score, title: entityId, href: "/", terms: [] }) as const;
  const folded = collapseToEntities(
    [hit("pdf:a#4", "a", 3), hit("pdf:b#0", "b", 2)],
    { entityId: "x" },
    (page: SearchHit) => (page.entityId === "a" ? "paper:a" : null),
  );
  assert.deepEqual(folded, [
    { id: "paper:a", score: 3 },
    { id: "pdf:b#0", score: 2 },
  ]);
});

test("distinctRelated lists a paper once, however the arms named it", () => {
  const docs: Record<string, Pick<SearchHit, "kind" | "entityId" | "title">> = {
    "paper:a": { kind: "paper", entityId: "a", title: "Faithful Bi-Directional Model Steering" },
    "pdf:a#3": { kind: "pdf", entityId: "a", title: "Faithful Bi-Directional Model Steering" },
    // A second record of the same paper, imported twice.
    "paper:a2": { kind: "paper", entityId: "a2", title: "Faithful bi-directional model steering." },
    "paper:b": { kind: "paper", entityId: "b", title: "Causal Abstractions of Neural Networks" },
    "paper:b2": { kind: "paper", entityId: "b2", title: "Causal Abstractions of Neural Networks.pdf" },
    // A note may share a paper's title — it is a different thing to open.
    "note:n": { kind: "note", entityId: "n", title: "Causal Abstractions of Neural Networks" },
    "paper:c": { kind: "paper", entityId: "c", title: "Structured Disentangled Representations" },
  };
  const results = ["paper:a", "pdf:a#3", "paper:b", "paper:a2", "note:n", "paper:b2", "gone", "paper:c"].map(
    (id, i) => ({ id, score: 10 - i }),
  );
  const kept = distinctRelated(results, (id) => docs[id] ?? null);
  // Order is kept and the best-ranked entry of each wins; an id the index no
  // longer resolves is passed through for the caller to drop.
  assert.deepEqual(kept.map((r) => r.id), ["paper:a", "paper:b", "note:n", "gone", "paper:c"]);
  assert.deepEqual(distinctRelated(results, (id) => docs[id] ?? null, 2).map((r) => r.id), ["paper:a", "paper:b"]);
});

test("distinctRelated reads a file-named import as the paper it is, and leaves out the seed's twin", () => {
  const docs: Record<string, Pick<SearchHit, "kind" | "entityId" | "title">> = {
    "paper:seed": { kind: "paper", entityId: "seed", title: "Nonparametric Variational Auto-Encoders" },
    "paper:file": { kind: "paper", entityId: "file", title: "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders.pdf" },
    "paper:x": { kind: "paper", entityId: "x", title: "Deep Variational Information Bottleneck" },
    "paper:y": { kind: "paper", entityId: "y", title: "Alemi - 2019 - Deep Variational Information Bottleneck.pdf" },
    // A title with a dash in it is not a file name.
    "paper:z": { kind: "paper", entityId: "z", title: "Self-Attention - A Survey" },
  };
  const results = ["paper:file", "paper:x", "paper:y", "paper:z"].map((id, i) => ({ id, score: 10 - i }));
  assert.deepEqual(
    distinctRelated(results, (id) => docs[id] ?? null, Infinity, "paper:seed").map((r) => r.id),
    ["paper:x", "paper:z"],
  );
});

test("distinctRelated knows a file name cut short is still the paper", () => {
  const titles: Record<string, string> = {
    "paper:seed": "Nonparametric Variational Auto-Encoders for Hierarchical Representation Learning",
    "paper:cut": "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders for Hierarchical R.pdf",
    "paper:other": "Nonparametric Bayes",
  };
  const resolve = (id: string) => ({ kind: "paper" as const, entityId: id, title: titles[id]! });
  const kept = distinctRelated([{ id: "paper:cut" }, { id: "paper:other" }], resolve, 5, "paper:seed");
  assert.deepEqual(kept.map((r) => r.id), ["paper:other"]);
});

test("distinctRelated knows a second download of the file is the same paper", () => {
  const titles: Record<string, string> = {
    "paper:seed": "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders.pdf",
    "paper:copy": "Goyal et al. - 2017 - Nonparametric Variational Auto-Encoders 1.pdf",
    "paper:gpt": "Language Models are Unsupervised Multitask Learners GPT 2",
  };
  const resolve = (id: string) => ({ kind: "paper" as const, entityId: id, title: titles[id]! });
  const kept = distinctRelated([{ id: "paper:copy" }, { id: "paper:gpt" }], resolve, 5, "paper:seed");
  assert.deepEqual(kept.map((r) => r.id), ["paper:gpt"]);
});

test("related lists two records of one paper once", async () => {
  const search = searchFor({
    papers: [
      paper("seed", "Causal abstraction for interpretability"),
      paper("dup1", "Causal abstraction of neural networks"),
      paper("dup2", "Causal Abstraction of Neural Networks"),
      paper("other", "Interpretability of causal models"),
    ],
  });
  await search.ensure();
  const ids = search.related("paper:seed", 8).map((r) => r.id);
  assert.ok(ids.length > 0);
  assert.equal(ids.filter((id) => id === "paper:dup1" || id === "paper:dup2").length, 1, ids.join(", "));
});

test("the semantic arm respects the kinds a caller asked for", async () => {
  const search = searchFor({
    papers: [paper("pa1", "Attention")],
    vaultPages: [note("n2", "Latents", "the posterior stays close to the prior")],
  });
  await search.ensure();
  search.setSemanticIndex(fakeSemantic(["note:n2", "paper:pa1"]));

  const hybrid = await search.searchHybrid("attention", { limit: 10, kinds: ["paper"] });
  assert.deepEqual(
    hybrid.map((h) => h.kind),
    hybrid.map(() => "paper"),
    "a papers-only list must not be handed a note by the vector arm",
  );
});

test("a vector hit below the noise floor does not become a match", async () => {
  const search = searchFor({
    vaultPages: [note("n1", "Attention", "positions"), note("n2", "Latents", "posterior")],
  });
  await search.ensure();
  search.setSemanticIndex({
    ready: true,
    async search() {
      return [{ id: "note:n2", score: 0.21 }];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  const hybrid = await search.searchHybrid("attention", { limit: 10 });
  assert.equal(hybrid.some((h) => h.id === "note:n2"), false);
});

test("the noise floor is the encoder's own, not a fixed number", async () => {
  const search = searchFor({
    vaultPages: [note("n1", "Attention", "positions"), note("n2", "Latents", "posterior")],
  });
  await search.ensure();
  // 0.45 clears MiniLM's 0.3 but is noise for a model whose unrelated pairs
  // sit near 0.5; with the model saying so, it must not match.
  search.setSemanticIndex({
    ready: true,
    minScore: 0.55,
    async search() {
      return [{ id: "note:n2", score: 0.45 }];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  const hybrid = await search.searchHybrid("attention", { limit: 10 });
  assert.equal(hybrid.some((h) => h.id === "note:n2"), false);
});

test("a keyword hit on one function word of a question is not fused in", async () => {
  const search = searchFor({
    vaultPages: [
      note("n1", "Residual learning", "shortcut connections for very deep networks"),
      note("n2", "Cooking", "how to boil pasta for dinner"),
    ],
  });
  await search.ensure();
  search.setSemanticIndex({
    ready: true,
    minScore: 0.28,
    async search() {
      return [{ id: "note:n1", score: 0.5 }];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  // "how" and "for" match the cooking note; neither is about anything.
  const hybrid = await search.searchHybrid("how to train very deep networks", { limit: 10 });
  assert.equal(hybrid[0]?.id, "note:n1");
  assert.equal(hybrid.some((h) => h.id === "note:n2"), false);
});

test("an off-topic question returns nothing once both arms are strict", async () => {
  const search = searchFor({
    vaultPages: [note("n1", "Residual learning", "shortcut connections for deep networks")],
  });
  await search.ensure();
  search.setSemanticIndex({
    ready: true,
    minScore: 0.28,
    async search() {
      return [{ id: "note:n1", score: 0.12 }];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  assert.deepEqual(await search.searchHybrid("how to cook pasta for dinner", { limit: 10 }), []);
});

test("related falls back to meaning when the graph has nothing, and says so", async () => {
  const search = searchFor({
    vaultPages: [note("n1", "Tuesday", "attention heads"), note("n2", "Heads", "multi-head self-attention")],
  });
  await search.ensure();
  search.setSemanticIndex({
    ready: true,
    nearestTo: () => [{ id: "note:n2", score: 0.8 }],
    async search() {
      return [];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  const related = await search.relatedHybrid("note:n1", 5);
  assert.equal(related[0]?.id, "note:n2");
  assert.equal(related[0]?.arm, "semantic");
});

test("related adds what is close in meaning to what wording found, and says which found each", async () => {
  const search = searchFor({
    vaultPages: [
      note("n1", "Attention heads", "attention heads in transformers"),
      note("n2", "Attention heads pruned", "pruning attention heads"),
      note("n3", "Tuesday", "what the probe found"),
    ],
  });
  await search.ensure();
  const wording = search.related("note:n1", 5);
  assert.ok(wording.some((hit) => hit.id === "note:n2"), "wording finds the shared title");
  search.setSemanticIndex({
    ready: true,
    nearestTo: () => [
      { id: "note:n3", score: 0.9 },
      { id: "note:n2", score: 0.7 },
    ],
    async search() {
      return [];
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);

  const related = await search.relatedHybrid("note:n1", 5);
  const byId = new Map(related.map((hit) => [hit.id, hit]));
  assert.deepEqual(byId.get("note:n3")?.arms, ["semantic"], "meaning alone found the note with no shared words");
  assert.deepEqual(byId.get("note:n2")?.arms, [wording.find((hit) => hit.id === "note:n2")!.arm, "semantic"]);
});

test("a refreshed note is handed to the semantic arm to re-embed", async () => {
  let body = "first draft";
  const search = new WorkspaceSearch({
    snapshot: async () => snapshot({ vaultPages: [note("n1", "Method", body)] }),
    projectId: () => "p1",
  });
  await search.ensure();

  const synced: string[][] = [];
  search.setSemanticIndex({
    ready: true,
    async sync(docs: readonly { id: string }[]) {
      synced.push(docs.map((d) => d.id));
      return true;
    },
  } as unknown as import("@/features/search/application/semantic-index").SemanticIndex);
  let changed = 0;
  search.onSemanticChanged = () => {
    changed += 1;
  };

  body = "second draft";
  search.markStale("vault_page");
  await search.ensure();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(synced, [["note:n1"]]);
  assert.equal(changed, 1);
});
