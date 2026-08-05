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
