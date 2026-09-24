import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPageMetadata, pageImportRefusal } from "../../../src/features/papers/index.js";

const URL_ = "https://example.org/post";

test("citation tags win and mark the page as a paper", () => {
  const meta = extractPageMetadata(
    `<meta name="citation_title" content="Real &amp; True">
     <meta name="citation_author" content="Ada Lovelace"><meta name="citation_author" content="Alan Turing">
     <meta name="citation_publication_date" content="2021/05/01">
     <meta name="citation_doi" content="https://doi.org/10.1234/ABC">
     <meta property="og:title" content="Something else">`,
    URL_,
  );
  assert.equal(meta.title, "Real & True");
  assert.deepEqual(meta.authors, ["Ada Lovelace", "Alan Turing"]);
  assert.equal(meta.year, 2021);
  assert.equal(meta.doi, "10.1234/ABC");
  assert.equal(meta.hasCitationMeta, true);
  assert.equal(pageImportRefusal(meta), null);
});

test("a blog post's JSON-LD gives its title, authors, date and site", () => {
  const meta = extractPageMetadata(
    `<title>Toy Models of Superposition — Transformer Circuits</title>
     <meta property="og:site_name" content="Transformer Circuits">
     <script type="application/ld+json">
       {"@context":"https://schema.org","@graph":[
         {"@type":"WebSite","name":"Transformer Circuits"},
         {"@type":["Article"],"headline":"Toy Models of Superposition",
          "author":[{"@type":"Person","name":"Nelson Elhage"},"Chris Olah"],
          "datePublished":"2022-09-14","publisher":{"name":"Anthropic"}}]}
     </script>`,
    URL_,
  );
  assert.equal(meta.title, "Toy Models of Superposition");
  assert.deepEqual(meta.authors, ["Nelson Elhage", "Chris Olah"]);
  assert.equal(meta.year, 2022);
  assert.equal(meta.venue, "Transformer Circuits");
  assert.equal(meta.isArticle, true);
  assert.equal(meta.hasCitationMeta, false);
  assert.equal(pageImportRefusal(meta), null);
});

test("OpenGraph article tags alone are enough, and the site suffix is dropped", () => {
  const meta = extractPageMetadata(
    `<meta property="og:type" content="article">
     <meta property="og:site_name" content="Lil'Log">
     <meta property="og:title" content="Prompt Engineering | Lil'Log">
     <meta name="author" content="Lilian Weng">
     <meta property="article:author" content="https://twitter.com/lilianweng">
     <meta property="article:published_time" content="2023-03-15T00:00:00+00:00">`,
    URL_,
  );
  assert.equal(meta.title, "Prompt Engineering");
  assert.deepEqual(meta.authors, ["Lilian Weng"]);
  assert.equal(meta.year, 2023);
  assert.equal(meta.isArticle, true);
});

test("a title that only looks like it has a suffix keeps it", () => {
  const meta = extractPageMetadata(
    `<meta property="og:type" content="article"><meta property="og:site_name" content="Blog">
     <title>Attention - is all you need</title>`,
    URL_,
  );
  assert.equal(meta.title, "Attention - is all you need");
});

test("a broken JSON-LD block is ignored, not thrown", () => {
  const meta = extractPageMetadata(
    `<script type="application/ld+json">{not json</script><title>Home</title>`,
    URL_,
  );
  assert.equal(meta.isArticle, false);
  assert.match(pageImportRefusal(meta) ?? "", /does not look like a paper or an article/);
});

test("a bot wall is refused by name, even when it says it is an article", () => {
  const meta = extractPageMetadata(
    `<meta property="og:type" content="article"><title>Just a moment...</title>`,
    URL_,
  );
  assert.match(pageImportRefusal(meta) ?? "", /blocked automated access/);
});

test("an arXiv id is read from the page's own address", () => {
  assert.equal(extractPageMetadata("<title>x</title>", "https://arxiv.org/abs/2101.00001v2").arxivId, "2101.00001");
});
