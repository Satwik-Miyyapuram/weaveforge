import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderMarkdownPlain, renderMarkdownWithShiki, renderProseMarkdown, splitFences } from "@/components/markdown/markdown";
import { containsMath, loadMathRenderer } from "@/components/markdown/math-renderer";

/**
 * The maths tests load KaTeX explicitly, and the app deliberately does not.
 *
 * `renderProseMarkdown` is synchronous and used to import KaTeX at module scope,
 * which put 75 KB of it in the first-load JS of six routes — including ones whose
 * screens have no maths on them. The renderer is loaded on demand now, and until
 * it arrives maths renders as a placeholder holding the source TeX.
 *
 * So the assertions below pass the renderer they are about. That keeps them
 * strong (real KaTeX output, real `trust: false` behaviour, real macro isolation)
 * while the default path is exercised by the placeholder tests further down.
 */
async function withKatex(): Promise<{ mathRenderer: Awaited<ReturnType<typeof loadMathRenderer>> }> {
  return { mathRenderer: await loadMathRenderer() };
}

test("renders inline and display equations locally", async () => {
  const options = await withKatex();
  const inline = renderProseMarkdown("The latent is $z = \\mu + \\sigma\\epsilon$.", options);
  const display = renderProseMarkdown("$$\\mathcal{L}_{VAE} = x^2$$", options);

  assert.match(inline, /class="katex"/);
  assert.match(display, /class="katex-display"/);
  assert.match(display, /mathcal/);
});

test("without a loaded renderer, maths is a placeholder holding the TeX", () => {
  // The default path, and the reason it is safe: a reader whose chunk has not
  // arrived (or never will) sees the formula the author wrote, not an empty box.
  const html = renderProseMarkdown("The latent is $z = \\mu$.", { mathRenderer: null });

  assert.match(html, /class="math-pending"/);
  assert.match(html, /z = \\mu/, "the source is shown, escaped");
  assert.doesNotMatch(html, /class="katex"/);
});

test("only text with maths triggers the load", () => {
  // A false positive costs a 75 KB fetch, so the delimiters are checked the way
  // the renderer recognises them.
  assert.equal(containsMath("Just prose about $5 and a shell $VAR."), true, "a bare dollar counts");
  assert.equal(containsMath("$$\\int_0^1 x\\,dx$$"), true);
  assert.equal(containsMath("Escaped: \\$5 only."), false, "an escaped dollar is not a delimiter");
  assert.equal(containsMath("No maths here at all."), false);
});

test("keeps code, escaped dollars, and URL dollars out of equation rendering", () => {
  const html = renderProseMarkdown("Price: \\$5. Code: `$x$`. Link: https://example.test/?value=$x$.");

  assert.equal((html.match(/class="katex"/g) ?? []).length, 0);
  assert.match(html, /<code>\$x\$<\/code>/);
  assert.match(html, /Price: \$5/);
  assert.match(html, /value=\$x\$/);
});

test("fails safely for untrusted or invalid TeX", async () => {
  const options = await withKatex();
  const html = renderProseMarkdown(
    "$\\href{javascript:alert(1)}{unsafe}$ and $\\notARealCommand$ and <script>alert(1)</script>",
    options,
  );

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

test("two Shiki renders in flight do not share a fence cursor", async () => {
  // A note opened from a link renders its preview and, a moment later, its
  // full body. Both passes await the highlighter between fences; a shared
  // global regex let each reset the other's position, and the first pass
  // came back with its prose twice.
  const fence = "```";
  const short = ["# Head", "", `${fence}mermaid`, "A-->B", fence, "", "tail"].join("\n");
  const long = [short, "", "## More", "", `${fence}js`, "x", fence, "", "end"].join("\n");
  const slow = async (code: string, info: string) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return `<pre data-lang="${info}">${code}</pre>`;
  };
  const [a, b] = await Promise.all([
    renderMarkdownWithShiki(short, "light", slow),
    renderMarkdownWithShiki(long, "light", slow),
  ]);
  assert.equal((a.match(/Head/g) ?? []).length, 1);
  assert.equal((a.match(/tail/g) ?? []).length, 1);
  assert.equal((b.match(/Head/g) ?? []).length, 1);
  assert.equal((b.match(/<pre /g) ?? []).length, 2);
});

test("two display formulas on one line stay two, not one spanning both (13-08)", () => {
  const html = renderProseMarkdown("$$a$$ and $$b$$", { mathRenderer: null });
  assert.doesNotMatch(html, /data-tex="a\$\$ and \$\$b"/);
  assert.equal(renderProseMarkdown("$$x + y$$", { mathRenderer: null }), '<div class="math-display"><div class="math-pending" data-tex="x + y">x + y</div></div>');
});

test("splitFences returns prose and fences in order, with info and body (13-07)", () => {
  assert.deepEqual(splitFences("intro\n```ts x\nconst a = 1;\n```\nmid\n```\nb\n```"), [
    { kind: "prose", text: "intro\n" },
    { kind: "fence", info: "ts x", code: "const a = 1;\n" },
    { kind: "prose", text: "\nmid\n" },
    { kind: "fence", info: "", code: "b\n" },
  ]);
  assert.deepEqual(splitFences(""), []);
  assert.deepEqual(splitFences("only prose"), [{ kind: "prose", text: "only prose" }]);
  assert.deepEqual(splitFences("```\nunclosed"), [{ kind: "prose", text: "```\nunclosed" }]);
});

test("a table needs no leading pipe, keeps escaped pipes, and takes wrapped rows", () => {
  const noLeadingPipe = renderProseMarkdown("a | b\n--- | ---\n1 | 2");
  assert.match(noLeadingPipe, /<table class="md-table">/);
  assert.match(noLeadingPipe, /<td>1<\/td><td>2<\/td>/);

  const escaped = renderProseMarkdown("| code | note |\n|---|---|\n| a \\| b | c \\|");
  assert.match(escaped, /<td>a \| b<\/td><td>c \|<\/td>/);

  const wrapped = renderProseMarkdown("| k | v |\n|---|---|\n| one | first part\nsecond part |\n| two | 2 |");
  assert.match(wrapped, /<td>one<\/td><td>first part second part<\/td>/);
  assert.match(wrapped, /<td>two<\/td><td>2<\/td>/);

  const afterBlank = renderProseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\nafter");
  assert.match(afterBlank, /<p>after<\/p>/);
});

test("prose on the line straight after a table joins its last cell, not a paragraph", () => {
  // Deliberate: a bare line with no pipe is the rest of the cell above (see tableCells).
  // GFM would make it a row of its own, so this is a known difference, pinned here.
  const html = renderProseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\nafter the table");
  assert.match(html, /<td>2 after the table<\/td>/);
  assert.doesNotMatch(html, /<p>after the table<\/p>/);
});

test("a list or heading straight after a table still ends it", () => {
  const list = renderProseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n- item");
  assert.match(list, /<\/table>/);
  assert.match(list, /<li>item<\/li>/);
  const heading = renderProseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n## after");
  assert.match(heading, /<h4[^>]*>after<\/h4>/);
});

test("inline and bracketed maths render; dollar amounts and code stay text", async () => {
  const options = await withKatex();
  const midParagraph = renderProseMarkdown("mid $$x+y$$ para", options);
  assert.match(midParagraph, /<span class="math-display-inline">[\s\S]*class="katex"/);
  assert.doesNotMatch(midParagraph, /\$/, "no stray dollar left behind");

  const brackets = renderProseMarkdown("\\(x^2\\) and \\[y\\]", options);
  assert.equal((brackets.match(/class="katex"/g) ?? []).length, 2);

  const prices = renderProseMarkdown("It costs $5 and $10 in total.", { mathRenderer: null });
  assert.doesNotMatch(prices, /math-pending/);
  assert.match(prices, /\$5 and \$10/);

  const code = renderProseMarkdown("Use `$x$` literally.", { mathRenderer: null });
  assert.match(code, /<code>\$x\$<\/code>/);
  assert.doesNotMatch(code, /math-pending/);
});

test("a display block may open or close on a line with content, and invalid TeX does not throw", async () => {
  const options = await withKatex();
  const multi = renderProseMarkdown("$$x+y\n+z$$", options);
  assert.match(multi, /<div class="math-display">[\s\S]*katex-display/);
  assert.doesNotMatch(multi, /<p>\$\$/);

  assert.doesNotThrow(() => renderProseMarkdown("$\\frac{$ and \\(\\unclosed", options));
});

test("containsMath recognises the bracketed delimiters too", () => {
  assert.equal(containsMath("\\(x\\)"), true);
  assert.equal(containsMath("\\[x\\]"), true);
  assert.equal(containsMath("plain text with a \\(escaped-looking word"), true);
  assert.equal(containsMath("no maths here"), false);
});

test("headings four to six hashes render as headings; seven stay text", () => {
  const html = renderProseMarkdown("#### four\n\n##### five\n\n###### six\n\n####### seven");
  assert.match(html, /<h6 class="md-h4"[^>]*>four<\/h6>/);
  assert.match(html, /<h6 class="md-h5"[^>]*>five<\/h6>/);
  assert.match(html, /<h6 class="md-h6"[^>]*>six<\/h6>/);
  assert.match(html, /<p>####### seven<\/p>/);
});

test("a heading of hashes alone is not an empty heading", () => {
  assert.doesNotMatch(renderProseMarkdown("####"), /<h6/);
});

test("inline code and maths inside a level-four heading keep their markup", () => {
  const html = renderProseMarkdown("#### `code` and $x^2$ here");
  assert.match(html, /<h6 class="md-h4"[^>]*><code>code<\/code> and <span class="(katex|math-pending)"/);
});

/** The font-size token that the first rule with exactly this selector sets. */
function headingSizeToken(selector: string): string {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/markdown.css", import.meta.url)), "utf8");
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    const head = block.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (head !== selector) continue;
    const token = /font-size:\s*(var\(--[\w-]+\))/.exec(block.slice(open + 1))?.[1];
    assert.ok(token, `${selector} sets no font-size token`);
    return token;
  }
  assert.fail(`no rule for ${selector}`);
}

test("levels four, five and six each get their own heading size", () => {
  const sizes = ["h6.md-h4", "h6.md-h5", "h6.md-h6"].map((level) => headingSizeToken(`.markdown ${level}`));
  assert.equal(new Set(sizes).size, 3, `sizes must differ: ${sizes.join(", ")}`);
});
