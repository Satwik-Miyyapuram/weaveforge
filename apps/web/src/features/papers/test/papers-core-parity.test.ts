import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// The Rust core is the only parser now; these literals pin its output for the
// inputs the TypeScript copies were checked against.

const ARXIV_CASES: Array<[string, string | undefined]> = [
  ["", undefined],
  ["2305.12345", "2305.12345"],
  ["2305.12345v3", "2305.12345"],
  ["arXiv:2305.12345", "2305.12345"],
  ["arXiv: 2305.12345", "2305.12345"],
  ["  2305.12345  ", "2305.12345"],
  ["https://arxiv.org/abs/2305.12345", "2305.12345"],
  ["https://arxiv.org/pdf/2305.12345v2.pdf", "2305.12345"],
  ["https://arxiv.org/abs/2305.12345?context=cs", "2305.12345"],
  ["https://arxiv.org/abs/cs.LG/0501001", "cs.LG/0501001"],
  ["hep-th/9901001", "hep-th/9901001"],
  ["10.48550/arXiv.hep-th/9901001", "hep-th/9901001"],
  ["https://arxiv.org/list/cs.LG/recent", undefined],
  ["https://example.com/papers/2305.12345.html", undefined],
  ["not an id", undefined],
];

const DOI_CASES: Array<[string, string | undefined]> = [
  ["10.1145/3592979", "10.1145/3592979"],
  ["https://doi.org/10.1145/3592979", "10.1145/3592979"],
  ["https://dx.doi.org/10.1145/3592979", "10.1145/3592979"],
  ["https://dl.acm.org/doi/10.1145/3592979", "10.1145/3592979"],
  ["doi:10.1145/3592979", "10.1145/3592979"],
  ["see (10.1145/3592979).", "10.1145/3592979"],
  ["doi:10.1145/3592979).", "10.1145/3592979"],
  ["10.1145/ABC.Def", "10.1145/abc.def"],
  ["https://example.com/paper", undefined],
];

const REF_CASES: Array<[Parameters<RustCore["parsePaperRef"]>[0], string, unknown]> = [
  ["zotero", "ABCD1234", { kind: "zotero", value: "ABCD1234" }],
  ["arxiv", "  2305.12345 ", { kind: "arxiv", value: "2305.12345" }],
  ["arxiv", "2306.09643", { kind: "arxiv", value: "2306.09643" }],
  ["url", "https://arxiv.org/html/2401.04088v1", { kind: "arxiv", value: "2401.04088" }],
  ["url", "https://arxiv.org/abs/2305.12345 (10.1145/3592979)", { kind: "arxiv", value: "2305.12345" }],
];

const BLOB_CASES: Array<[string, string]> = [
  ["a.pdf", "application/pdf"],
  ["a.PDF", "application/pdf"],
  ["x/y.png", "image/png"],
  ["x.jpg", "image/jpeg"],
  ["x.jpeg", "image/jpeg"],
  ["x.gif", "image/gif"],
  ["x.webp", "image/webp"],
  ["x.svg", "image/svg+xml"],
  ["x.md", "application/octet-stream"],
  ["x.json", "application/octet-stream"],
  ["x.html", "application/octet-stream"],
  ["noext", "application/octet-stream"],
  ["x.", "application/octet-stream"],
  ["dir.d/file", "application/octet-stream"],
  ["x.tar.gz", "application/octet-stream"],
  ["x.mp4", "application/octet-stream"],
];

test("normalizeArxivId returns the bare id for each literal input", () => {
  for (const [input, expected] of ARXIV_CASES) {
    assert.equal(rs.normalizeArxivId(input), expected, `input ${JSON.stringify(input)}`);
  }
});

test("extractDoi returns the lowercase DOI for each literal input", () => {
  for (const [input, expected] of DOI_CASES) {
    assert.equal(rs.extractDoi(input), expected, `input ${JSON.stringify(input)}`);
  }
});

test("parsePaperRef routes each literal value to its kind", () => {
  for (const [kind, value, expected] of REF_CASES) {
    assert.deepEqual(rs.parsePaperRef(kind, value), expected, `kind ${kind} input ${JSON.stringify(value)}`);
  }
});

test("extractPageMetadata reads the arXiv id from the page address", () => {
  const cases: Array<[string, string]> = [
    ["https://arxiv.org/abs/2101.00001v2", "2101.00001"],
    ["https://arxiv.org/abs/2305.12345v2", "2305.12345"],
    ["https://arxiv.org/pdf/2305.12345.pdf", "2305.12345"],
    ["https://arxiv.org/abs/cs/0501001", "cs/0501001"],
  ];
  for (const [url, arxivId] of cases) {
    assert.equal(rs.extractPageMetadata("<html></html>", url).arxivId, arxivId, url);
  }
});

test("extractPageMetadata reads citation tags and accepts the page", () => {
  const html =
    `<meta name="citation_title" content="Attention Is All You Need"><meta name="citation_author" content="Ashish Vaswani">` +
    `<meta name="citation_author" content="Noam Shazeer"><meta name="citation_doi" content="10.1/x">` +
    `<meta name="citation_publication_date" content="2021/05/03"><meta name="citation_journal_title" content="NeurIPS">`;
  const meta = rs.extractPageMetadata(html, "https://example.org/page");
  assert.equal(meta.title, "Attention Is All You Need");
  assert.equal(rs.pageImportRefusal(meta), null);
});

test("guessBlobContentType maps each literal path by extension", () => {
  for (const [path, expected] of BLOB_CASES) {
    assert.equal(rs.guessBlobContentType(path), expected, `path ${JSON.stringify(path)}`);
  }
});
