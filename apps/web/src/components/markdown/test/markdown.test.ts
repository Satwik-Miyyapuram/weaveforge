import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdownPlain, renderProseMarkdown } from "@/components/markdown/markdown";

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

test("renderMarkdownPlain renders prose around a fence and escapes the code", () => {
  const html = renderMarkdownPlain("## Title\n\n```ts\nconst a = 1 < 2;\n```\n\n- item");

  assert.match(html, /<h4[^>]*>Title<\/h4>/);
  assert.match(html, /<pre class="md-code" data-lang="ts"><code>const a = 1 &lt; 2;\n<\/code><\/pre>/);
  assert.match(html, /<ul><li>item<\/li><\/ul>/);
});

test("an image reference is rendered whatever store it names", () => {
  // The sheet's text layer renders through this one plain pass, and a paper
  // note's figure is `paperimg:` — not a URL the browser can fetch, so the
  // prefix was simply not matched and the image came out as its own markdown
  // source. All four prefixes a note may carry become an `<img>`; making the
  // src fetchable is the caller's `resolveImageSrc`.
  const html = renderMarkdownPlain(
    [
      "![a](vault:u/p/a.png)",
      "![b](paperimg:u/p/b.png)",
      "![c](reportimg:u/p/c.png)",
      "![d](https://example.test/d.png)",
    ].join("\n\n"),
  );
  assert.equal((html.match(/<img /g) ?? []).length, 4);
  assert.match(html, /src="paperimg:u\/p\/b\.png"/);
  assert.doesNotMatch(html, /!\[b\]/);
});

test("resolveImageSrc rewrites a src, and a null answer drops the reference", () => {
  const asked: string[] = [];
  const html = renderMarkdownPlain("![a](paperimg:u/p/a.png)\n\n![b](paperimg:u/p/gone.png)", {
    resolveImageSrc: (src) => {
      asked.push(src);
      return src.endsWith("a.png") ? "blob:resolved" : null;
    },
  });

  assert.deepEqual(asked, ["paperimg:u/p/a.png", "paperimg:u/p/gone.png"]);
  assert.match(html, /src="blob:resolved"/);
  // The one that could not be fetched is gone, not a broken image.
  assert.doesNotMatch(html, /gone\.png/);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
});
