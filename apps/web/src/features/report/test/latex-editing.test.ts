import assert from "node:assert/strict";
import { test } from "node:test";

import { latexFoldEnd } from "../lib/latex-fold";
import { headingOf, latexFormat, type LatexEdit } from "../lib/latex-format";
import { latexOutline, nestOutline, sectionAt, type OutlineNode } from "../lib/latex-outline";

const DOC = [
  "\\documentclass{article}", // 1
  "\\begin{document}", // 2
  "\\section{Intro}", // 3
  "Some text.", // 4
  "% \\section{Commented out}", // 5
  "\\subsection*{Why \\emph{this}}", // 6
  "\\subsection[Short]{Long title}", // 7
  "\\section{Method} % trailing note", // 8
  "\\begin{itemize}", // 9
  "  \\item a", // 10
  "  \\begin{itemize}", // 11
  "    \\item b", // 12
  "  \\end{itemize}", // 13
  "\\end{itemize}", // 14
  "\\end{document}", // 15
].join("\n");

// ---- Outline ----

test("the outline lists sections with their level and 1-based line, skipping comments", () => {
  assert.deepEqual(latexOutline(DOC), [
    { level: 2, title: "Intro", line: 3 },
    { level: 3, title: "Why this", line: 6 },
    { level: 3, title: "Long title", line: 7 },
    { level: 2, title: "Method", line: 8 },
  ]);
});

test("chapters and parts rank above sections; an escaped percent is not a comment", () => {
  const text = "\\part{P}\n\\chapter{C}\n\\section{50\\% done}\n\\subsubsection{D}\n\\paragraph{E}";
  assert.deepEqual(latexOutline(text).map((i) => [i.level, i.title]), [
    [0, "P"], [1, "C"], [2, "50% done"], [4, "D"], [5, "E"],
  ]);
});

test("a heading with no closing brace is left out, and an empty file has no outline", () => {
  assert.deepEqual(latexOutline("\\section{Open\nmore"), []);
  assert.deepEqual(latexOutline(""), []);
});

test("nestOutline puts lower levels under the heading above them", () => {
  const titles = (nodes: OutlineNode[]): unknown[] => nodes.map((n) => (n.children.length ? [n.title, titles(n.children)] : n.title));
  assert.deepEqual(titles(nestOutline(latexOutline(DOC))), [["Intro", ["Why this", "Long title"]], "Method"]);
  // A subsection before any section stays at the top.
  assert.deepEqual(titles(nestOutline(latexOutline("\\subsection{A}\n\\section{B}\n\\subsection{C}"))), ["A", ["B", ["C"]]]);
});

test("sectionAt gives the heading the cursor line is under, or null above the first", () => {
  const items = latexOutline(DOC);
  assert.equal(sectionAt(items, 2), null);
  assert.equal(sectionAt(items, 3)?.title, "Intro");
  assert.equal(sectionAt(items, 5)?.title, "Intro");
  assert.equal(sectionAt(items, 7)?.title, "Long title");
  assert.equal(sectionAt(items, 15)?.title, "Method");
});

// ---- Folding ----

const lines = DOC.split("\n");
const foldEnd = (lineNumber: number) => {
  const end = latexFoldEnd((i) => lines[i]!, lines.length, lineNumber - 1);
  return end === null ? null : end + 1;
};

test("a section folds up to the next heading of the same or a higher level", () => {
  assert.equal(foldEnd(3), 7, "Intro folds over its subsections, up to Method");
  assert.equal(foldEnd(6), null, "a one-line section has nothing to fold");
  assert.equal(foldEnd(8), 14, "the last section stops before \\end{document}");
});

test("an environment folds to its own \\end, past nested ones of the same name", () => {
  assert.equal(foldEnd(9), 13);
  assert.equal(foldEnd(11), 12);
  assert.equal(foldEnd(2), 14);
  assert.equal(foldEnd(4), null, "plain text does not fold");
  assert.equal(latexFoldEnd((i) => ["\\begin{x}", "a"][i]!, 2, 0), null, "an unclosed environment does not fold");
});

// ---- Formatting ----

/** Applies an edit and marks the new selection with [ and ]. */
function apply(doc: string, edit: LatexEdit) {
  const out = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
  const [a, b] = [Math.min(edit.anchor, edit.head), Math.max(edit.anchor, edit.head)];
  return out.slice(0, a) + "[" + out.slice(a, b) + "]" + out.slice(b);
}

test("bold, italic and math wrap the selection and keep it selected", () => {
  const doc = "say word now";
  assert.equal(apply(doc, latexFormat("bold", doc, 4, 8)), "say \\textbf{[word]} now");
  assert.equal(apply(doc, latexFormat("italic", doc, 4, 8)), "say \\textit{[word]} now");
  assert.equal(apply(doc, latexFormat("math", doc, 4, 8)), "say $[word]$ now");
});

test("with nothing selected the command goes in with the cursor inside", () => {
  assert.equal(apply("ab", latexFormat("bold", "ab", 1, 1)), "a\\textbf{[]}b");
  assert.equal(apply("ab", latexFormat("link", "ab", 1, 1)), "a\\href{[]}{}b");
});

test("a link puts the selection as its text and the cursor in the URL", () => {
  assert.equal(apply("see here", latexFormat("link", "see here", 4, 8)), "see \\href{[]}{here}");
});

test("display math and lists open on their own lines", () => {
  assert.equal(apply("x", latexFormat("displayMath", "x", 1, 1)), "x\\[\n  []\n\\]");
  assert.equal(apply("", latexFormat("itemize", "", 0, 0)), "\\begin{itemize}\n  \\item []\n\\end{itemize}");
  assert.equal(apply("one", latexFormat("enumerate", "one", 0, 3)), "\\begin{enumerate}\n  \\item [one]\n\\end{enumerate}");
});

test("comment toggles a % on every selected line", () => {
  const doc = "a\n  b\nc";
  const on = latexFormat("comment", doc, 0, 4);
  assert.equal(apply(doc, on).replace(/[[\]]/g, ""), "% a\n  % b\nc");
  const commented = "% a\n  % b\nc";
  assert.equal(apply(commented, latexFormat("comment", commented, 0, 8)).replace(/[[\]]/g, ""), "a\n  b\nc");
});

test("a heading style replaces the cursor line's heading, and Normal text removes it", () => {
  const doc = "x\n\\section{Intro}\ny";
  assert.equal(headingOf("\\section{Intro}"), "section");
  assert.equal(headingOf("\\subsection*{A}"), "subsection");
  assert.equal(headingOf("plain"), "normal");
  assert.equal(apply(doc, latexFormat("subsection", doc, 4, 4)).replace(/[[\]]/g, ""), "x\n\\subsection{Intro}\ny");
  assert.equal(apply(doc, latexFormat("normal", doc, 4, 4)).replace(/[[\]]/g, ""), "x\nIntro\ny");
  assert.equal(apply("Plain", latexFormat("section", "Plain", 2, 2)).replace(/[[\]]/g, ""), "\\section{Plain}");
});
