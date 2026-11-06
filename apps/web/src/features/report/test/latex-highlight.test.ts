import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { highlightTree } from "@lezer/highlight";

import { latexHighlight } from "../lib/latex-highlight";

const SRC = "\\begin{itemize} % list\n\\item $x^2$ \\textbf{bold}\n\\usepackage[opt]{x}\n\\end{itemize}";

function classes(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  highlightTree(StreamLanguage.define(stex).parser.parse(src), latexHighlight, (from, to, cls) => {
    out[src.slice(from, to)] = cls;
  });
  return out;
}

test("LaTeX tokens get their own classes, as Overleaf colours them", () => {
  const c = classes(SRC);
  assert.equal(c["\\begin"], "cm-tex-command");
  assert.equal(c["\\textbf"], "cm-tex-command");
  assert.equal(c["itemize"], "cm-tex-arg", "environment names");
  assert.equal(c["opt"], "cm-tex-arg", "options");
  assert.equal(c["$"], "cm-tex-math");
  assert.equal(c["x"], "cm-tex-math");
  assert.equal(c["% list"], "cm-tex-comment");
  assert.equal(c["{"], "cm-tex-bracket");
  assert.equal(c["bold"], undefined, "plain text keeps the ink colour");
});
