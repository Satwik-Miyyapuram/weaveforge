import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaperHtmlDocument,
  isSubstantialPaperText,
  MIN_PAPER_TEXT_CHARS,
  PAPER_HTML_CSP,
  parsePaperHtmlDocument,
  type PaperHtmlPage,
} from "../application/paper-html";

const page: PaperHtmlPage = {
  paperId: "p1",
  url: 'https://arxiv.org/html/2101.00001?a=1&b="2"',
  title: "Tom & Jerry <revisited>",
  html: "<h1>Intro</h1>\n<p>Body</p>",
  savedAt: "2026-09-24T10:00:00.000Z",
};

test("a kept page round-trips through its file", () => {
  const doc = buildPaperHtmlDocument(page);
  assert.deepEqual(parsePaperHtmlDocument("p1", doc), page);
});

test("the file escapes the title and source, and carries the frame's CSP", () => {
  const doc = buildPaperHtmlDocument(page);
  assert.ok(doc.includes("<title>Tom &amp; Jerry &lt;revisited&gt;</title>"));
  assert.ok(doc.includes('content="https://arxiv.org/html/2101.00001?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(doc.includes(`content="${PAPER_HTML_CSP}"`));
  assert.ok(!/script-src/.test(PAPER_HTML_CSP));
  assert.ok(doc.includes(">arxiv.org</a>"));
});

test("the scheme is pinned only when asked", () => {
  assert.ok(buildPaperHtmlDocument(page, { scheme: "dark" }).includes("color-scheme: dark"));
  assert.ok(!buildPaperHtmlDocument(page).includes("color-scheme: dark"));
});

test("a file this app did not write is not read as a kept page", () => {
  assert.equal(parsePaperHtmlDocument("p1", "<html><body><p>hand made</p></body></html>"), null);
  const noSource = buildPaperHtmlDocument(page).replace(/<meta name="weaveforge-source"[^>]*>/, "");
  assert.equal(parsePaperHtmlDocument("p1", noSource), null);
});

test("only a page with the paper's text counts, not an abstract", () => {
  assert.equal(isSubstantialPaperText("x".repeat(MIN_PAPER_TEXT_CHARS - 1)), false);
  assert.equal(isSubstantialPaperText("x".repeat(MIN_PAPER_TEXT_CHARS)), true);
});
