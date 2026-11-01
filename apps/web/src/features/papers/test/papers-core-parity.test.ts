import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS copies can be deleted.
const IDS_AND_DOIS = [
  "",
  "   ",
  "2305.12345",
  "2305.12345v3",
  "arXiv:2305.12345v1",
  "arxiv 2305.12345",
  "https://arxiv.org/abs/2305.12345v2",
  "https://arxiv.org/pdf/2305.12345.pdf",
  "cs.LG/0501001",
  "math.AG/0501001v2",
  "10.1145/3290605.3300233",
  "doi:10.1145/3290605.3300233.",
  "https://doi.org/10.1145/3290605.3300233),;",
  "https://dl.acm.org/doi/10.1145/3290605.3300233",
  "10.1000%2Fabc",
  "100%",
  "https://example.com/paper",
  "Some prose with DOI 10.5555/12345678 inside.",
  "ARXIV:2305.12345",
  "10.1234/ABC",
];

const REF_KINDS = ["doi", "arxiv", "url", "zotero"] as const;
const REF_INPUTS = [
  ...IDS_AND_DOIS,
  "example.com/paper",
  "www.nature.com/articles/x",
  "http://x.org",
  "not a ref",
];

const PAGE_URL = "https://example.org/page";
const PAGE_FIXTURES = [
  `<meta name="citation_title" content="Attention Is All You Need"><meta name="citation_author" content="Ashish Vaswani"><meta name="citation_author" content="Noam Shazeer"><meta name="citation_doi" content="10.1/x"><meta name="citation_publication_date" content="2021/05/03"><meta name="citation_journal_title" content="NeurIPS">`,
  `<title>Just a moment...</title>`,
  `<script type="application/ld+json">{"@type":"ScholarlyArticle","headline":"LD Paper","author":[{"name":"A B"}],"datePublished":"2020-01-01"}</script>`,
  `<meta property="og:title" content="OG Title"><meta property="og:type" content="article">`,
  `<html></html>`,
  `<meta name="citation_title" content="Caf&eacute; &amp; Co &#x2014; x">`,
  `<title>My Paper | Nature</title><meta name="dc.title" content="My Paper">`,
];

const BLOB_PATHS = [
  "a.pdf",
  "a.PDF",
  "x/y.png",
  "x.jpg",
  "x.jpeg",
  "x.gif",
  "x.webp",
  "x.svg",
  "x.md",
  "x.json",
  "x.txt",
  "x.html",
  "noext",
  "x.",
  "dir.d/file",
  "x.unknown",
  "x.tar.gz",
  "x.mp4",
  "x.csv",
];

test("normalizeArxivId matches the TS parser", () => {
  for (const x of IDS_AND_DOIS) {
    assert.deepEqual(rs.normalizeArxivId(x), ts.normalizeArxivId(x), `input ${JSON.stringify(x)}`);
  }
});

test("extractDoi matches the TS parser", () => {
  for (const x of IDS_AND_DOIS) {
    assert.deepEqual(rs.extractDoi(x), ts.extractDoi(x), `input ${JSON.stringify(x)}`);
  }
});

test("parsePaperRef matches the TS parser for every kind", () => {
  for (const kind of REF_KINDS) {
    for (const v of REF_INPUTS) {
      assert.deepEqual(rs.parsePaperRef(kind, v), ts.parsePaperRef(kind, v), `kind ${kind} input ${JSON.stringify(v)}`);
    }
  }
});

test("extractPageMetadata and pageImportRefusal match the TS parser", () => {
  for (const html of PAGE_FIXTURES) {
    const a = JSON.parse(JSON.stringify(rs.extractPageMetadata(html, PAGE_URL)));
    const b = JSON.parse(JSON.stringify(ts.extractPageMetadata(html, PAGE_URL)));
    assert.deepEqual(a, b, `html ${JSON.stringify(html)}`);
    assert.equal(rs.pageImportRefusal(a), ts.pageImportRefusal(b), `html ${JSON.stringify(html)}`);
  }
});

test("guessBlobContentType matches the TS guesser", () => {
  for (const path of BLOB_PATHS) {
    assert.equal(rs.guessBlobContentType(path), ts.guessBlobContentType(path), `path ${JSON.stringify(path)}`);
  }
});
