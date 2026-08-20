import assert from "node:assert/strict";
import test from "node:test";
import { renderProseMarkdown } from "../markdown";

test("renders inline and display equations locally", () => {
  const inline = renderProseMarkdown("The latent is $z = \\mu + \\sigma\\epsilon$.");
  const display = renderProseMarkdown("$$\\mathcal{L}_{VAE} = x^2$$");

  assert.match(inline, /class="katex"/);
  assert.match(display, /class="katex-display"/);
  assert.match(display, /mathcal/);
});

test("keeps code, escaped dollars, and URL dollars out of equation rendering", () => {
  const html = renderProseMarkdown("Price: \\$5. Code: `$x$`. Link: https://example.test/?value=$x$.");

  assert.equal((html.match(/class="katex"/g) ?? []).length, 0);
  assert.match(html, /<code>\$x\$<\/code>/);
  assert.match(html, /Price: \$5/);
  assert.match(html, /value=\$x\$/);
});

test("fails safely for untrusted or invalid TeX", () => {
  const html = renderProseMarkdown("$\\href{javascript:alert(1)}{unsafe}$ and $\\notARealCommand$ and <script>alert(1)</script>");

  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /mathcolor="#cc0000"/);
});

test("renders a GFM table, with alignment and ragged rows", () => {
  const html = renderProseMarkdown(
    ["| Gene | p | Note |", "|---|--:|:-:|", "| TP53 | 0.01 | driver |", "| BRCA1 |"].join("\n"),
  );

  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<th>Gene<\/th>/);
  assert.match(html, /<th class="md-right">p<\/th>/);
  assert.match(html, /<th class="md-center">Note<\/th>/);
  // The short row keeps its cell and gains empty ones rather than vanishing.
  assert.match(html, /<td>BRCA1<\/td><td class="md-right"><\/td><td class="md-center"><\/td>/);
});

test("leaves a pipe that is not a table alone", () => {
  const html = renderProseMarkdown("| not a table, no divider row");

  assert.doesNotMatch(html, /<table/);
  assert.match(html, /not a table/);
});

test("renders numbered lists as an ordered list", () => {
  const html = renderProseMarkdown(["1. first", "2. second", "- bullet"].join("\n"));

  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<ul><li>bullet<\/li><\/ul>/);
});

test("links a root-relative target in the same tab, and leaves a bare file name as text", () => {
  const html = renderProseMarkdown("See [paste](/docs/paste) and [other](other.md).");

  assert.match(html, /<a href="\/docs\/paste">paste<\/a>/);
  assert.doesNotMatch(html, /href="other\.md"/);
  assert.match(html, /\[other\]\(other\.md\)/);
});
