import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePaperPdfUrl,
  sanitizePdfUrl,
  sanitizeReaderHref,
} from "../application/sanitize-reader-url.js";

test("sanitizePdfUrl accepts http(s) and rejects javascript/data/credentials", () => {
  assert.equal(sanitizePdfUrl("https://arxiv.org/pdf/1706.03762"), "https://arxiv.org/pdf/1706.03762");
  assert.equal(sanitizePdfUrl("http://example.com/a.pdf"), "http://example.com/a.pdf");
  assert.equal(sanitizePdfUrl("javascript:alert(1)"), null);
  assert.equal(sanitizePdfUrl("data:text/html,hi"), null);
  assert.equal(sanitizePdfUrl("https://user:pass@evil.test/a.pdf"), null);
  assert.equal(sanitizePdfUrl("not a url"), null);
  assert.equal(sanitizePdfUrl(""), null);
  assert.equal(sanitizePdfUrl(null), null);
});

test("sanitizeReaderHref allows only /reader paths", () => {
  assert.equal(sanitizeReaderHref("/reader?paper=p1"), "/reader?paper=p1");
  assert.equal(sanitizeReaderHref("/reader"), "/reader");
  assert.equal(sanitizeReaderHref("https://evil.test/reader"), null);
  assert.equal(sanitizeReaderHref("javascript:alert(1)"), null);
  assert.equal(sanitizeReaderHref("//evil.test"), null);
  assert.equal(sanitizeReaderHref("/reader-evil"), null);
  assert.equal(sanitizeReaderHref("/papers"), null);
});

test("resolvePaperPdfUrl maps arXiv abs and ids to pdf URLs", () => {
  assert.equal(
    resolvePaperPdfUrl({ url: "https://arxiv.org/abs/1706.03762" }),
    "https://arxiv.org/pdf/1706.03762",
  );
  assert.equal(
    resolvePaperPdfUrl({ arxivId: "1706.03762" }),
    "https://arxiv.org/pdf/1706.03762",
  );
  assert.equal(
    resolvePaperPdfUrl({ url: "https://example.com/paper.pdf" }),
    "https://example.com/paper.pdf",
  );
  assert.equal(resolvePaperPdfUrl({ url: "https://example.com/landing" }), null);
  assert.equal(resolvePaperPdfUrl({ url: "javascript:alert(1)" }), null);
});
