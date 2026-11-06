import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, LanguageSupport } from "@codemirror/language";
import { LaTeXLanguage } from "../vendor/overleaf/languages/latex/latex-language";
import { atomicDecorations } from "../vendor/overleaf/extensions/visual/atomic-decorations";

const DOC = String.raw`\section{Intro}

Some \textbf{bold} and $x^2$ here.

end`;

function state(cursor: number) {
  const s = EditorState.create({ doc: DOC, extensions: [new LanguageSupport(LaTeXLanguage), atomicDecorations] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s.update({ selection: { anchor: cursor } }).state;
}

function widgets(s: EditorState) {
  const out: string[] = [];
  for (const d of s.facet(EditorView.decorations)) {
    if (typeof d === "function") continue;
    d.between(0, s.doc.length, (from, to, v) => {
      const w = v.spec.widget;
      if (w) out.push(`${w.constructor.name}:${s.doc.sliceString(from, to)}`);
    });
  }
  return out;
}

test("Overleaf LaTeX parser reads sectioning, bold and math", () => {
  const tree = ensureSyntaxTree(state(DOC.length), DOC.length, 5000)!;
  const names = new Set<string>();
  tree.iterate({ enter: (n) => { names.add(n.name); } });
  for (const name of ["SectioningCommand", "Section", "TextBoldCommand", "InlineMath"]) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});

const MARKUP = [String.raw`BraceWidget:\section{`, "BraceWidget:}", String.raw`BraceWidget:\textbf{`, "BraceWidget:}"];

test("Visual hides command markup and draws math when the cursor is away", () => {
  assert.deepEqual(widgets(state(DOC.length)), [...MARKUP, "MathWidget:$x^2$"]);
});

test("Visual shows the math source again under the cursor", () => {
  assert.deepEqual(widgets(state(DOC.indexOf("x^2"))), MARKUP);
});
