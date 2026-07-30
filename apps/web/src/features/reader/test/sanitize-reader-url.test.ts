import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikePdfUrl,
  resolvePaperPdfUrl,
  sanitizePdfUrl,
  sanitizeReaderHref,
  isReaderObjectUrl,
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

test("sanitizeAppHref allows known app roots only", async () => {
  const { sanitizeAppHref } = await import("../application/sanitize-reader-url.js");
  assert.equal(sanitizeAppHref("/papers?paper=p1"), "/papers?paper=p1");
  assert.equal(sanitizeAppHref("/notes?id=n1"), "/notes?id=n1");
  assert.equal(sanitizeAppHref("/reader?paper=p1"), "/reader?paper=p1");
  assert.equal(sanitizeAppHref("//evil.test"), null);
  assert.equal(sanitizeAppHref("/evil"), null);
  assert.equal(sanitizeAppHref("https://evil.test/papers"), null);
  assert.equal(sanitizeAppHref("/papers/../api/secret"), null);
  assert.equal(sanitizeAppHref("/link/../settings"), null);
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

test("isReaderObjectUrl accepts this origin's object URLs and nothing else", () => {
  const origin = "https://weaveforge.test";
  const priorLocation = (globalThis as { location?: unknown }).location;
  Object.defineProperty(globalThis, "location", {
    value: { origin },
    configurable: true,
    writable: true,
  });
  try {
    // The reader caches PDF bytes and re-opens them through createObjectURL, so
    // the second visit to any paper is a blob: URL. Rejecting it made the reader
    // refuse to open a paper it had cached itself.
    assert.equal(isReaderObjectUrl(`blob:${origin}/2f1c-4b`), true);
    // Another origin's handle is not ours to read.
    assert.equal(isReaderObjectUrl("blob:https://evil.example/2f1c-4b"), false);
    assert.equal(isReaderObjectUrl("blob:not-a-url"), false);
    assert.equal(isReaderObjectUrl("https://arxiv.org/pdf/1706.03762"), false);
    assert.equal(isReaderObjectUrl("javascript:alert(1)"), false);
    assert.equal(isReaderObjectUrl(null), false);
  } finally {
    Object.defineProperty(globalThis, "location", {
      value: priorLocation,
      configurable: true,
      writable: true,
    });
  }
});

test("sanitizePdfUrl still refuses object URLs, so links never point at blobs", () => {
  // isReaderObjectUrl is only for handing bytes to pdf.js; an <a href> or
  // "open original" link must remain an https URL.
  assert.equal(sanitizePdfUrl("blob:https://weaveforge.test/2f1c-4b"), null);
});
