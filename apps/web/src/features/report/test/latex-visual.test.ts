import assert from "node:assert/strict";
import { test } from "node:test";

import { latexVisualSpans } from "../lib/latex-visual";

/** A cursor far past the text, so nothing is revealed. */
const AWAY = [{ from: 9999, to: 9999 }];

test("a heading hides its command and braces and keeps its level", () => {
  const src = "\\section{Intro}\n\\subsection*{Why}";
  assert.deepEqual(latexVisualSpans(src, AWAY), [
    { kind: "heading", level: 1, from: 0, to: 15, hide: [[0, 9], [14, 15]] },
    { kind: "heading", level: 2, from: 16, to: 33, hide: [[16, 29], [32, 33]] },
  ]);
});

test("bold, italic and emph hide their markup, nested ones too", () => {
  const src = "a \\textbf{b} \\emph{c} \\textit{\\textbf{d}}";
  assert.deepEqual(latexVisualSpans(src, AWAY), [
    { kind: "bold", from: 2, to: 12, hide: [[2, 10], [11, 12]] },
    { kind: "italic", from: 13, to: 21, hide: [[13, 19], [20, 21]] },
    { kind: "italic", from: 22, to: 41, hide: [[22, 30], [40, 41]] },
    { kind: "bold", from: 30, to: 40, hide: [[30, 38], [39, 40]] },
  ]);
});

test("the span under the cursor shows its source; the others stay rendered", () => {
  const src = "\\textbf{a} \\textbf{b}";
  const spans = latexVisualSpans(src, [{ from: 4, to: 4 }]);
  assert.deepEqual(spans.map((s) => s.from), [11]);
  assert.equal(latexVisualSpans(src, [{ from: 10, to: 10 }]).length, 1, "the cursor at a span's end reveals it");
});

test("a selection over a span reveals it", () => {
  assert.deepEqual(latexVisualSpans("x \\emph{y} z", [{ from: 0, to: 12 }]), []);
});

test("inline math becomes one span with its TeX; escaped dollars and $$ do not", () => {
  assert.deepEqual(latexVisualSpans("so $x^2$ and \\$5 or $$y$$", AWAY), [
    { kind: "math", from: 3, to: 8, tex: "x^2" },
  ]);
});

test("\\item becomes a bullet", () => {
  assert.deepEqual(latexVisualSpans("  \\item one\n\\itemize", AWAY), [{ kind: "item", from: 2, to: 7 }]);
});

test("comments and unclosed braces stay as source", () => {
  assert.deepEqual(latexVisualSpans("% \\textbf{x} $y$\n\\textbf{open", AWAY), []);
  assert.deepEqual(latexVisualSpans("a 50\\% \\emph{b}", AWAY).map((s) => s.kind), ["italic"], "an escaped % is not a comment");
});
