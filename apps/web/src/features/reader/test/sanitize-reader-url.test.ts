import assert from "node:assert/strict";
import test, { before } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";

before(loadTestCore);

test("sanitizePdfUrl accepts https only and rejects javascript/data/credentials/http", () => {
  assert.equal(readyCore().sanitizePdfUrl("https://arxiv.org/pdf/1706.03762"), "https://arxiv.org/pdf/1706.03762");
  assert.equal(readyCore().sanitizePdfUrl("http://example.com/a.pdf"), null);
  assert.equal(readyCore().sanitizePdfUrl("javascript:alert(1)"), null);
  assert.equal(readyCore().sanitizePdfUrl("data:text/html,hi"), null);
  assert.equal(readyCore().sanitizePdfUrl("https://user:pass@evil.test/a.pdf"), null);
  assert.equal(readyCore().sanitizePdfUrl("not a url"), null);
  assert.equal(readyCore().sanitizePdfUrl(""), null);
  assert.equal(readyCore().sanitizePdfUrl(null), null);
});

test("sanitizeReaderHref allows only /reader paths", () => {
  assert.equal(readyCore().sanitizeReaderHref("/reader?paper=p1"), "/reader?paper=p1");
  assert.equal(readyCore().sanitizeReaderHref("/reader"), "/reader");
  assert.equal(readyCore().sanitizeReaderHref("https://evil.test/reader"), null);
  assert.equal(readyCore().sanitizeReaderHref("javascript:alert(1)"), null);
  assert.equal(readyCore().sanitizeReaderHref("//evil.test"), null);
  assert.equal(readyCore().sanitizeReaderHref("/reader-evil"), null);
  assert.equal(readyCore().sanitizeReaderHref("/papers"), null);
});

test("sanitizeAppHref allows known app roots only", () => {
  assert.equal(readyCore().sanitizeAppHref("/papers?paper=p1"), "/papers?paper=p1");
  assert.equal(readyCore().sanitizeAppHref("/notes?id=n1"), "/notes?id=n1");
  assert.equal(readyCore().sanitizeAppHref("/reader?paper=p1"), "/reader?paper=p1");
  assert.equal(readyCore().sanitizeAppHref("//evil.test"), null);
  assert.equal(readyCore().sanitizeAppHref("/evil"), null);
  assert.equal(readyCore().sanitizeAppHref("https://evil.test/papers"), null);
  assert.equal(readyCore().sanitizeAppHref("/papers/../api/secret"), null);
  assert.equal(readyCore().sanitizeAppHref("/link/../settings"), null);
});

test("resolvePaperPdfUrl maps arXiv abs and ids to pdf URLs", () => {
  assert.equal(
    readyCore().resolvePaperPdfUrl({ url: "https://arxiv.org/abs/1706.03762" }),
    "https://arxiv.org/pdf/1706.03762",
  );
  assert.equal(
    readyCore().resolvePaperPdfUrl({ arxivId: "1706.03762" }),
    "https://arxiv.org/pdf/1706.03762",
  );
  assert.equal(
    readyCore().resolvePaperPdfUrl({ url: "https://example.com/paper.pdf" }),
    "https://example.com/paper.pdf",
  );
  assert.equal(
    readyCore().resolvePaperPdfUrl({ url: "https://openreview.net/pdf?id=abc" }),
    "https://openreview.net/pdf?id=abc",
  );
  assert.equal(readyCore().resolvePaperPdfUrl({ url: "https://example.com/landing" }), null);
  assert.equal(readyCore().resolvePaperPdfUrl({ url: "javascript:alert(1)" }), null);
});

test("looksLikePdfUrl rejects HTML paths that merely contain /pdf/", () => {
  assert.equal(readyCore().looksLikePdfUrl("https://example.com/blog/pdf/guide.html"), false);
  assert.equal(readyCore().looksLikePdfUrl("https://openreview.net/pdf?id=abc"), true);
  assert.equal(readyCore().looksLikePdfUrl("https://host.example/pdf/abc123"), true);
  assert.equal(readyCore().looksLikePdfUrl("https://doi.org/doi/pdf/10.1/xyz"), true);
});

test("sanitizePdfUrl still refuses object URLs, so links never point at blobs", () => {
  // isReaderObjectUrl is only for handing bytes to pdf.js; an <a href> or
  // "open original" link must remain an https URL.
  assert.equal(readyCore().sanitizePdfUrl("blob:https://weaveforge.test/2f1c-4b"), null);
});

/**
 * The library indexer decides which papers are worth fetching by asking this
 * function, because the reader resolves them with it too. They diverged once:
 * the indexer filtered on `pdfPath`, a field reserved for a storage ladder that
 * does not exist and that nothing writes, so "index the whole library" reported
 * every paper as unreadable and did nothing. These pin the agreement.
 */
test("a paper with only an arXiv id is readable, and so indexable", () => {
  assert.ok(readyCore().resolvePaperPdfUrl({ arxivId: "1706.03762" }));
  assert.ok(readyCore().resolvePaperPdfUrl({ arxivId: "arXiv:1706.03762" }));
});

test("a paper with only a direct PDF url is readable", () => {
  assert.ok(readyCore().resolvePaperPdfUrl({ url: "https://example.edu/papers/attention.pdf" }));
});

test("a paper with no url and no identifier is not readable", () => {
  assert.equal(readyCore().resolvePaperPdfUrl({}), null);
  assert.equal(readyCore().resolvePaperPdfUrl({ url: "   " }), null);
});

test("resolvePaperPdfUrl falls back to the reported open-access copy when the landing page is HTML", () => {
  // A paper added from a reference list: DOI, Semantic Scholar landing page,
  // and the open-access link S2 reported. Only the last is a PDF.
  assert.equal(
    readyCore().resolvePaperPdfUrl({
      url: "https://www.semanticscholar.org/paper/abc",
      openAccessPdf: "https://arxiv.org/pdf/1207.0580v1",
    }),
    "https://arxiv.org/pdf/1207.0580v1",
  );
  // An arXiv id still wins; an HTML or http open-access link is skipped.
  assert.equal(
    readyCore().resolvePaperPdfUrl({ arxivId: "1706.03762", openAccessPdf: "https://example.com/x.pdf" }),
    "https://arxiv.org/pdf/1706.03762",
  );
  assert.equal(
    readyCore().resolvePaperPdfUrl({ url: "https://example.com/landing", openAccessPdf: "http://dl.acm.org/ft_gateway.cfm?id=1&type=pdf" }),
    null,
  );
  assert.equal(readyCore().resolvePaperPdfUrl({ openAccessPdf: "" }), null);
});
