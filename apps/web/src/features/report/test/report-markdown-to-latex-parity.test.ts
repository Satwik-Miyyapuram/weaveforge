import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust Markdown-to-LaTeX export returns exactly what the TS original in
// packages/core/src/features/report/domain/markdown-to-latex.ts returns. Reports are seeded
// mixes of every construct it handles, so a failure reproduces from the seed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

const BLOCKS = [
  "# Title",
  "## Section & more",
  "### Sub_section 50%",
  "Plain text with $x^2$ inline math and \\backslash.",
  "$$\n\\int_0^1 f(x)\\,dx\n$$",
  "**bold** and *italic* and `code_span` here.",
  "- one\n- two\n- three",
  "1. first\n2. second",
  "> a quote ~ tilde",
  "```python\nprint('{hi}')\n```",
  "```\n\\end{verbatim} inside\n```",
  "![Plot](reportimg:projects/p1/plot.png)",
  "![Plot again](reportimg:other/plot.png)",
  "![Web](https://example.org/x.png)",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "<div>raw html</div>",
  "See [[Attention Is All You Need]] and [[Unknown Paper|alias]].",
  "A [link](https://example.org/a_b) in text.",
  "Café, naïve, 漢字 and emoji 🎉.",
  "---",
  "",
  "#hashtag not a heading",
];

const CITE_BY_TITLE = new Map([
  [ts.normalizeTitleKey("Attention Is All You Need"), "vaswani2017"],
  [ts.normalizeTitleKey("Deep Residual Learning"), "he2016"],
]);

function report(rand: () => number): string {
  const count = Math.floor(rand() * 10);
  return Array.from({ length: count }, () => pick(rand, BLOCKS)).join(rand() < 0.8 ? "\n\n" : "\n");
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test("markdownToLatex matches TS on seeded reports, with and without a cite map", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const md = report(rand);
    const opts = rand() < 0.5 ? { citeByTitle: CITE_BY_TITLE } : {};
    assert.deepStrictEqual(rs.markdownToLatex(md, opts), ts.markdownToLatex(md, opts), `seed ${seed}`);
  }
});

test("markdownToLatex handles empty input and the default options", () => {
  assert.deepStrictEqual(rs.markdownToLatex(""), ts.markdownToLatex(""));
  assert.deepStrictEqual(rs.markdownToLatex("# Hi"), ts.markdownToLatex("# Hi"));
});

test("escapeLatexText matches TS on every special character", () => {
  for (const s of ["", "plain", "\\", "{}$&#^_%~", "a\\{b}", "100% & $5", "~~\\\\", "漢字 🎉"]) {
    assert.equal(rs.escapeLatexText(s), ts.escapeLatexText(s), JSON.stringify(s));
  }
});
