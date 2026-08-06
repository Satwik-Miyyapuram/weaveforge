import assert from "node:assert/strict";
import test from "node:test";
import type { PdfIndexSource, WorkspaceSnapshot } from "@thesis/core";
import { WorkspaceSearch } from "@/features/search/application/workspace-search";

/**
 * `WorkspaceSearch` reaches IndexedDB for the PDF text store and the index
 * cache. Neither exists here, and both are written to fail soft, so the class
 * behaves as it would on a device with storage disabled — which is exactly the
 * surface these tests are about.
 */

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
    readerAnnotations: [],
    collectedAt: "2026-08-05T00:00:00.000Z",
    ...over,
  };
}

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
