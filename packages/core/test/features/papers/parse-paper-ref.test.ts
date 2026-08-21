import assert from "node:assert/strict";
import test from "node:test";
import { extractDoi, normalizeArxivId, parsePaperRef } from "../../../src/features/papers/application/parse-paper-ref.js";

test("normalizeArxivId reads abs / pdf URLs, prefixed forms, and bare ids", () => {
  const id = "2305.12345";
  assert.equal(normalizeArxivId("https://arxiv.org/abs/2305.12345"), id);
  assert.equal(normalizeArxivId("http://arxiv.org/abs/2305.12345v3"), id);
  assert.equal(normalizeArxivId("https://arxiv.org/pdf/2305.12345v2.pdf"), id);
  assert.equal(normalizeArxivId("https://arxiv.org/abs/2305.12345?context=cs"), id);
  assert.equal(normalizeArxivId("arXiv:2305.12345"), id);
  assert.equal(normalizeArxivId("arXiv: 2305.12345v1"), id);
  assert.equal(normalizeArxivId("  2305.12345  "), id);
  assert.equal(normalizeArxivId("2305.12345v2"), id);
});

test("normalizeArxivId handles legacy ids and rejects non-ids", () => {
  assert.equal(normalizeArxivId("https://arxiv.org/abs/cs.LG/0501001"), "cs.LG/0501001");
  assert.equal(normalizeArxivId("hep-th/9901001"), "hep-th/9901001");
  assert.equal(normalizeArxivId("https://example.com/papers/2305.12345.html"), undefined);
  assert.equal(normalizeArxivId("not an id"), undefined);
  assert.equal(normalizeArxivId(""), undefined);
  assert.equal(normalizeArxivId(undefined), undefined);
});

test("extractDoi pulls a DOI out of URLs, prefixes, and prose", () => {
  const doi = "10.1145/3592979";
  assert.equal(extractDoi(doi), doi);
  assert.equal(extractDoi("https://doi.org/10.1145/3592979"), doi);
  assert.equal(extractDoi("https://dx.doi.org/10.1145/3592979"), doi);
  assert.equal(extractDoi("https://dl.acm.org/doi/10.1145/3592979"), doi);
  assert.equal(extractDoi("doi:10.1145/3592979"), doi);
  assert.equal(extractDoi("see (10.1145/3592979)."), doi);
  assert.equal(extractDoi("10.1145/3592979"), doi);
  assert.equal(extractDoi("https://example.com/paper"), undefined);
});

test("extractDoi lowercases — DOIs are case-insensitive, dedupe is not", () => {
  assert.equal(extractDoi("10.1145/ABC.Def"), "10.1145/abc.def");
});

test("parsePaperRef routes a pasted value to the source that can answer it", () => {
  assert.deepEqual(parsePaperRef("url", "https://arxiv.org/abs/2305.12345"), {
    kind: "arxiv",
    value: "2305.12345",
  });
  // A DOI dropped in the arXiv box still resolves.
  assert.deepEqual(parsePaperRef("arxiv", "https://doi.org/10.1145/3592979"), {
    kind: "doi",
    value: "10.1145/3592979",
  });
  // An arXiv link dropped in the DOI box, likewise.
  assert.deepEqual(parsePaperRef("doi", "arXiv:2305.12345"), {
    kind: "arxiv",
    value: "2305.12345",
  });
  // arXiv wins over a DOI in the same string: it also carries the abstract.
  assert.deepEqual(parsePaperRef("url", "https://arxiv.org/abs/2305.12345 (10.1145/3592979)"), {
    kind: "arxiv",
    value: "2305.12345",
  });
});

test("parsePaperRef leaves opaque and plain values alone", () => {
  // Zotero keys have no structure to detect — never re-classify them.
  assert.deepEqual(parsePaperRef("zotero", "ABCD1234"), { kind: "zotero", value: "ABCD1234" });
  assert.deepEqual(parsePaperRef("url", "https://example.com/paper"), {
    kind: "url",
    value: "https://example.com/paper",
  });
  // A scheme-less URL is still a URL — in any box, with or without a path.
  assert.deepEqual(parsePaperRef("url", "example.com/papers/x"), {
    kind: "url",
    value: "https://example.com/papers/x",
  });
  assert.deepEqual(parsePaperRef("doi", "www.nature.com/articles/s41586-021-03819-2"), {
    kind: "url",
    value: "https://www.nature.com/articles/s41586-021-03819-2",
  });
  assert.deepEqual(parsePaperRef("url", "openreview.net"), {
    kind: "url",
    value: "https://openreview.net",
  });
  assert.deepEqual(parsePaperRef("arxiv", "  2305.12345 "), { kind: "arxiv", value: "2305.12345" });
});

test("parsePaperRef accepts http and https alike, and both scheme-less forms", () => {
  // Explicit http is preserved — never silently rewritten to https, because a
  // http-only host would then fail to resolve.
  assert.deepEqual(parsePaperRef("url", "http://example.com/paper"), {
    kind: "url",
    value: "http://example.com/paper",
  });
  assert.deepEqual(parsePaperRef("url", "HTTPS://Example.com/Paper"), {
    kind: "url",
    value: "HTTPS://Example.com/Paper",
  });
  // arXiv and DOI detection is scheme-agnostic.
  for (const v of [
    "http://arxiv.org/abs/2305.12345",
    "https://arxiv.org/abs/2305.12345",
    "arxiv.org/abs/2305.12345",
    "www.arxiv.org/abs/2305.12345",
  ]) {
    assert.deepEqual(parsePaperRef("url", v), { kind: "arxiv", value: "2305.12345" }, v);
  }
  for (const v of ["http://doi.org/10.1145/3592979", "doi.org/10.1145/3592979"]) {
    assert.deepEqual(parsePaperRef("url", v), { kind: "doi", value: "10.1145/3592979" }, v);
  }
});

test("parsePaperRef does not mistake a bare id for a hostname", () => {
  assert.deepEqual(parsePaperRef("arxiv", "2306.09643"), { kind: "arxiv", value: "2306.09643" });
  // Nonsense stays with the declared kind rather than becoming a URL.
  assert.deepEqual(parsePaperRef("arxiv", "some paper title"), {
    kind: "arxiv",
    value: "some paper title",
  });
});
