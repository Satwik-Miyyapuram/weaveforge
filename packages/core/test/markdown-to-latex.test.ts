import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToLatex } from "../src/features/report/domain/markdown-to-latex.js";

test("markdownToLatex converts headings, emphasis, and lists", () => {
  const { latex, warnings } = markdownToLatex("# Intro\n\nHello **world**\n\n- a\n- b");
  assert.match(latex, /\\section\{Intro\}/);
  assert.match(latex, /\\textbf\{world\}/);
  assert.match(latex, /\\begin\{itemize\}/);
  assert.match(latex, /\\item a/);
  assert.equal(warnings.length, 0);
});

test("markdownToLatex preserves inline and display math as TeX", () => {
  const { latex } = markdownToLatex("Energy $E=mc^2$\n\n$$\\int x$$");
  assert.match(latex, /\$E=mc\^2\$/);
  assert.match(latex, /\\\[\\int x\\\]/);
});

test("markdownToLatex converts reportimg figures to includegraphics", () => {
  const { latex, warnings, images } = markdownToLatex(
    "See ![Plot A](reportimg:user/sec/a.webp) and more.",
  );
  assert.match(latex, /\\includegraphics\[width=\\linewidth\]\{figures\/a\.webp\}/);
  assert.match(latex, /\\caption\{Plot A\}/);
  assert.deepEqual(images, [{ path: "user/sec/a.webp", fileName: "a.webp" }]);
  assert.equal(warnings.length, 0);
});

test("markdownToLatex still warns on non-report images", () => {
  const { warnings } = markdownToLatex("![x](https://example.com/x.png)");
  assert.ok(warnings.some((w) => w.includes("non-report image")));
});

test("markdownToLatex turns [[Paper]] into \\cite when mapped", () => {
  const citeByTitle = new Map([["a paper", "doi_10_1234"]]);
  const { latex, citedKeys, warnings } = markdownToLatex(
    "As shown in [[A Paper]] and [[A Paper|short]].",
    { citeByTitle },
  );
  assert.match(latex, /As shown in \\cite\{doi_10_1234\} and \\cite\{doi_10_1234\}\./);
  assert.deepEqual(citedKeys, ["doi_10_1234"]);
  assert.equal(warnings.length, 0);
});

test("markdownToLatex leaves unresolved wikilinks as text with a warning", () => {
  const citeByTitle = new Map([["a paper", "k1"]]);
  const { latex, warnings } = markdownToLatex("See [[Unknown Note]].", { citeByTitle });
  assert.match(latex, /See Unknown Note\./);
  assert.doesNotMatch(latex, /\\cite/);
  assert.ok(warnings.some((w) => w.includes("[[Unknown Note]]")));
});
