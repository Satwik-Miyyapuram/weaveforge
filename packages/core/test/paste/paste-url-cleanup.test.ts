import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUrlCleanupOptions,
  cleanUrl,
  cleanUrlsInText,
  parseLinkRemovals,
  trimUrlTail,
  urlBoundary,
} from "../../src/paste/url-cleanup.js";

const options = buildUrlCleanupOptions();

test("strips campaign and click parameters", () => {
  assert.equal(
    cleanUrl(
      "https://www.theverge.com/2026/1/9/story?utm_source=newsletter&utm_medium=email&fbclid=IwAR2x9",
      options,
    ),
    "https://www.theverge.com/2026/1/9/story",
  );
});

test("keeps the parameters that address content", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&si=8f2a1c&utm_source=share&t=42";
  assert.equal(cleanUrl(url, options), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxAbC123&t=42");
});

test("leaves a scholarly link alone", () => {
  for (const url of [
    "https://doi.org/10.1000/182",
    "https://arxiv.org/abs/1706.03762v7",
    "https://api.semanticscholar.org/graph/v1/paper/649def34?fields=title,year",
    "https://pubmed.ncbi.nlm.nih.gov/12345678/",
  ]) {
    assert.equal(cleanUrl(url, options), url, url);
  }
});

test("a site rule matches subdomains and any top-level domain", () => {
  assert.equal(
    cleanUrl("https://www.google.co.uk/search?q=obsidian+plugins&client=safari&sca_esv=9f1", options),
    "https://www.google.co.uk/search?q=obsidian+plugins",
  );
  // google.example.com is not Google.
  const impostor = "https://google.example.com/search?q=a&client=safari";
  assert.equal(cleanUrl(impostor, options), impostor);
});

test("a signed URL is returned byte for byte", () => {
  const signed =
    "https://files.example.com/paper.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&utm_source=mail&X-Amz-Signature=abcd";
  assert.equal(cleanUrl(signed, options), signed);
});

test("drops a scroll-to-text fragment but keeps a real anchor", () => {
  assert.equal(
    cleanUrl("https://example.com/a#results:~:text=the%20finding", options),
    "https://example.com/a#results",
  );
  assert.equal(cleanUrl("https://example.com/a#:~:text=the%20finding", options), "https://example.com/a");
});

test("a URL needing no work keeps its exact spelling", () => {
  const url = "https://example.com/a?B=1&b=2#Frag";
  assert.equal(cleanUrl(url, options), url);
  assert.equal(cleanUrl("not a url", options), "not a url");
  assert.equal(cleanUrl("mailto:a@b.example", options), "mailto:a@b.example");
});

test("trims prose punctuation off a URL but keeps a balanced bracket", () => {
  assert.equal(trimUrlTail("https://example.com/a."), "https://example.com/a");
  assert.equal(trimUrlTail("https://example.com/a),"), "https://example.com/a");
  assert.equal(
    trimUrlTail("https://en.wikipedia.org/wiki/Foo_(film)"),
    "https://en.wikipedia.org/wiki/Foo_(film)",
  );
  assert.equal(trimUrlTail("**https://example.com/a**"), "**https://example.com/a");
});

test("a wikilink pasted flush behind a URL is not swallowed", () => {
  const boundary = urlBoundary("https://example.com/a[[Note]]");
  assert.equal(boundary.url, "https://example.com/a");
  assert.equal(boundary.ambiguous, false);
});

test("an undecidable bracket after a query leaves the URL uncleaned", () => {
  const text = "https://example.com/a?filter=[[1,2]]&utm_source=x";
  assert.equal(cleanUrlsInText(text, options).text, text);
});

test("cleans a Markdown link destination and a bare link in prose", () => {
  const result = cleanUrlsInText(
    "See [the story](https://a.example/x?utm_source=n) and https://b.example/y?fbclid=1.",
    options,
  );
  assert.equal(result.text, "See [the story](https://a.example/x) and https://b.example/y.");
  assert.equal(result.count, 2);
});

test("a URL inside code is left alone", () => {
  const text = "```\ncurl https://a.example/x?utm_source=n\n```";
  assert.equal(cleanUrlsInText(text, options).text, text);
  const inline = "Run `https://a.example/x?utm_source=n` first";
  assert.equal(cleanUrlsInText(inline, options).text, inline);
});

test("a second link absorbed into the first match is never deleted", () => {
  // A comma is legal in a query, so there is nothing here that says where the
  // first address stopped. Cleaning would drop the second link entirely.
  const text = "https://a.example/x?utm_source=n,https://b.example/y?utm_medium=e";
  const result = cleanUrlsInText(text, options);
  assert.equal(result.text, text);
  assert.equal(result.count, 0);
});

test("two links separated by Markdown syntax are both cleaned", () => {
  const result = cleanUrlsInText(
    "[a](https://a.example/x?utm_source=n)[b](https://b.example/y?utm_medium=e)",
    options,
  );
  assert.equal(result.text, "[a](https://a.example/x)[b](https://b.example/y)");
  assert.equal(result.count, 2);
});

test("parses the three shapes of user rule", () => {
  const parsed = parseLinkRemovals([
    "# a comment",
    "fbclid",
    "mine.example | source, ref",
    "!youtube.com",
    "   ",
  ]);
  assert.deepEqual(parsed.globalParameters, ["fbclid"]);
  assert.deepEqual(parsed.disabledDomains, ["youtube.com"]);
  assert.equal(parsed.siteRemovals.length, 1);
  assert.deepEqual(parsed.siteRemovals[0]?.parameters, ["source", "ref"]);
});

test("a user rule adds a removal and a bang line turns a built-in one off", () => {
  const withUser = buildUrlCleanupOptions(["mine.example | ref"]);
  assert.equal(cleanUrl("https://mine.example/a?ref=x&keep=1", withUser), "https://mine.example/a?keep=1");

  const disabled = buildUrlCleanupOptions(["!youtube.com"]);
  const url = "https://www.youtube.com/watch?v=abc&si=123";
  assert.equal(cleanUrl(url, disabled), url);
});
