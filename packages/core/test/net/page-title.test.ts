import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeHtmlEntities,
  extractPageTitle,
  looksLikeImageUrl,
} from "../../src/net/page-title.js";

const title = (html: string) => extractPageTitle(html)?.title;

test("OpenGraph wins, because it is the site saying what to call this link", () => {
  assert.equal(
    title(`<head><title>Site — Page</title><meta property="og:title" content="The Real Title"></head>`),
    "The Real Title",
  );
});

test("the title element is the fallback", () => {
  assert.equal(title("<html><head><title>Obsidian - Sharpen your thinking</title></head>"), "Obsidian - Sharpen your thinking");
  assert.equal(title("<html><head></head><body>no title</body>"), undefined);
  assert.equal(title("<title>   </title>"), undefined);
});

test("entities are decoded, ampersand last", () => {
  assert.equal(title("<title>Tom &amp; Jerry &#8212; a study</title>"), "Tom & Jerry — a study");
  assert.equal(decodeHtmlEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeHtmlEntities("&#x2014;"), "—");
  assert.equal(decodeHtmlEntities("&#999999999;"), "");
});

test("whitespace across lines collapses", () => {
  assert.equal(title("<title>\n  A  wrapped\n  title\n</title>"), "A wrapped title");
});

test("a challenge page is flagged rather than used silently", () => {
  // Answering 200 with an ordinary <title> is exactly what these pages do, so
  // without the flag a pasted link becomes "[Just a moment…](…)".
  for (const wall of ["Just a moment...", "Attention Required! | Cloudflare", "Access denied", "403 Forbidden"]) {
    const result = extractPageTitle(`<title>${wall}</title>`);
    assert.equal(result?.suspect, true, wall);
  }
  assert.equal(extractPageTitle("<title>A real article</title>")?.suspect, false);
});

test("an unclosed title element does not swallow the document", () => {
  assert.equal(title("<title>opened but never closed"), undefined);
});

test("a very long title is cut rather than pasted whole", () => {
  const long = "x".repeat(1000);
  assert.equal(title(`<title>${long}</title>`)?.length, 300);
});

test("attributes in any quoting style are read", () => {
  assert.equal(title(`<meta property='og:title' content='Single quoted'>`), "Single quoted");
  assert.equal(title(`<meta property=og:title content=Bare>`), "Bare");
});

test("an image URL is recognised by its path, and nothing else is guessed", () => {
  assert.equal(looksLikeImageUrl("https://a.example/figure.png"), true);
  assert.equal(looksLikeImageUrl("https://a.example/figure.JPEG?width=200"), true);
  assert.equal(looksLikeImageUrl("https://a.example/article"), false);
  assert.equal(looksLikeImageUrl("https://a.example/a.png.html"), false);
  assert.equal(looksLikeImageUrl("not a url"), false);
});
