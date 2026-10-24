/**
 * Word counts for a linked Overleaf report are computed once per tree, not
 * once per node and again for every ancestor (30-15). Totals are unchanged.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { LatexSectionNode } from "@weaveforge/core";
import { sectionBody, sectionWordCounts } from "../lib/section-word-counts";

const node = (id: string, file: string, startLine: number, endLine: number, children: LatexSectionNode[] = []): LatexSectionNode => ({
  id, title: id, command: "section", level: 1, file, startLine, endLine, preview: "", children,
});

const files = [
  {
    path: "main.tex",
    content: [
      "\\section{Intro}", // 1
      "One two three.", // 2
      "\\subsection{Why}", // 3
      "Four five % a comment", // 4
      "\\textbf{six} $x$", // 5
      "\\section{End}", // 6
      "Seven.", // 7
    ].join("\r\n"),
  },
  { path: "ch.tex", content: "\\section{Ch}\nalpha beta" },
];

const why = node("why", "main.tex", 3, 5);
const intro = node("intro", "main.tex", 1, 5, [why]);
const end = node("end", "main.tex", 6, 7);
const ch = node("ch", "ch.tex", 1, 2);
const gone = node("gone", "missing.tex", 1, 3);

test("each node counts its own prose plus its subsections", () => {
  const counts = sectionWordCounts([intro, end, ch, gone], files);
  assert.equal(counts.get("why"), 3); // Four five x: commands and their arguments drop
  assert.equal(counts.get("intro"), 3 + 3);
  assert.equal(counts.get("end"), 1);
  assert.equal(counts.get("ch"), 2);
  assert.equal(counts.get("gone"), 0);
});

test("the report total is the sum of its roots", () => {
  const counts = sectionWordCounts([intro, end, ch], files);
  const total = [intro, end, ch].reduce((sum, n) => sum + counts.get(n.id)!, 0);
  assert.equal(total, 6 + 1 + 2);
});

test("a section body stops at its first child", () => {
  assert.equal(sectionBody(intro, files), "One two three.");
  assert.equal(sectionBody(gone, files), "");
});

test("an empty tree counts nothing", () => {
  assert.equal(sectionWordCounts([], files).size, 0);
});
