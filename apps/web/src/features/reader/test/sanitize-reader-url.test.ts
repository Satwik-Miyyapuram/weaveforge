import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikePdfUrl,
  resolvePaperPdfUrl,
  sanitizePdfUrl,
  sanitizeReaderHref,
} from "../application/sanitize-reader-url.js";

test("sanitizePdfUrl accepts https only and rejects javascript/data/credentials/http", () => {
  assert.equal(sanitizePdfUrl("https://arxiv.org/pdf/1706.03762"), "https://arxiv.org/pdf/1706.03762");
  assert.equal(sanitizePdfUrl("http://example.com/a.pdf"), null);
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
  assert.equal(
    resolvePaperPdfUrl({ url: "https://openreview.net/pdf?id=abc" }),
    "https://openreview.net/pdf?id=abc",
  );
  assert.equal(resolvePaperPdfUrl({ url: "https://example.com/landing" }), null);
  assert.equal(resolvePaperPdfUrl({ url: "javascript:alert(1)" }), null);
});

test("looksLikePdfUrl rejects HTML paths that merely contain /pdf/", () => {
  assert.equal(looksLikePdfUrl("https://example.com/blog/pdf/guide.html"), false);
  assert.equal(looksLikePdfUrl("https://openreview.net/pdf?id=abc"), true);
  assert.equal(looksLikePdfUrl("https://host.example/pdf/abc123"), true);
  assert.equal(looksLikePdfUrl("https://doi.org/doi/pdf/10.1/xyz"), true);
});

test("proxiedPdfUrl rewrites allowlisted hosts through the same-origin proxy", async () => {
  const { proxiedPdfUrl } = await import("../application/sanitize-reader-url.js");
  assert.equal(
    proxiedPdfUrl("https://arxiv.org/pdf/1706.03762"),
    "/api/pdf-proxy?url=" + encodeURIComponent("https://arxiv.org/pdf/1706.03762"),
  );
  assert.equal(proxiedPdfUrl("https://evil.test/a.pdf"), "https://evil.test/a.pdf");
});
