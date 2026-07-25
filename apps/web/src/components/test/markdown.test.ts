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
