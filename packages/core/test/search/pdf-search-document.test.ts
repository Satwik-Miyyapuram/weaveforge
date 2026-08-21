import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PDF_PAGE_CHARS,
  pdfDocId,
  pdfDocIdsFor,
  pdfPageHref,
  toPdfSearchDocs,
  type PdfIndexSource,
} from "../../src/index.js";

const EXTRACTED = "2026-08-05T00:00:00.000Z";

function source(over: Partial<PdfIndexSource> = {}): PdfIndexSource {
  return {
    paperId: "p1",
    title: "Attention Is All You Need",
    extractedAt: EXTRACTED,
    pages: [
      { pageIndex: 0, text: "The dominant sequence transduction models use recurrence." },
      { pageIndex: 1, text: "We propose a new simple network architecture, the Transformer." },
    ],
    ...over,
  };
}

test("one document per page, so a hit can say which page", () => {
  const docs = toPdfSearchDocs([source()]);

  assert.equal(docs.length, 2);
  assert.deepEqual(
    docs.map((d) => d.page),
    [0, 1],
  );
});

test("hits deep-link to the page the match is on", () => {
  const docs = toPdfSearchDocs([source()]);

  assert.equal(docs[1]!.href, "/reader?paper=p1&page=1");
  assert.equal(pdfPageHref("p 1", 3), "/reader?paper=p%201&page=3");
});

test("ids are stable and unique per page", () => {
  const docs = toPdfSearchDocs([source()]);

  assert.equal(docs[0]!.id, pdfDocId("p1", 0));
  assert.equal(new Set(docs.map((d) => d.id)).size, 2);
});

test("entityId is the paper, so kind filters and dedupe behave", () => {
  const docs = toPdfSearchDocs([source()]);

  assert.ok(docs.every((d) => d.entityId === "p1"));
  assert.ok(docs.every((d) => d.kind === "pdf"));
});

test("near-empty pages are skipped as figures or scan artefacts", () => {
  const docs = toPdfSearchDocs([
    source({
      pages: [
        { pageIndex: 0, text: "   " },
        { pageIndex: 1, text: "x".repeat(MIN_PDF_PAGE_CHARS - 1) },
        { pageIndex: 2, text: "x".repeat(MIN_PDF_PAGE_CHARS + 1) },
      ],
    }),
  ]);

  assert.equal(docs.length, 1);
  assert.equal(docs[0]!.page, 2);
});

test("a page inherits its paper's link degree", () => {
  const docs = toPdfSearchDocs([source()], new Map([["paper:p1", 9]]));

  assert.ok(docs.every((d) => d.degree === 9), "pages have no links of their own");
});

test("the page number is searchable as an alias and shown in the path", () => {
  const docs = toPdfSearchDocs([source()]);

  assert.deepEqual(docs[0]!.aliases, ["p1"]);
  assert.equal(docs[1]!.path, "page 2", "paths are 1-based for humans");
});

test("page ids can be enumerated to replace a re-extracted document", () => {
  assert.deepEqual(pdfDocIdsFor("p1", 3), [
    pdfDocId("p1", 0),
    pdfDocId("p1", 1),
    pdfDocId("p1", 2),
  ]);
});

test("no sources yields no documents", () => {
  assert.deepEqual(toPdfSearchDocs([]), []);
  assert.deepEqual(toPdfSearchDocs([source({ pages: [] })]), []);
});
