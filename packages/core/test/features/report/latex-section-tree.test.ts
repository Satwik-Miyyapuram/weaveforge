import assert from "node:assert/strict";
import test from "node:test";
import { parseLatexSectionTree } from "../../../src/features/report/domain/latex-section-tree.js";

test("builds a nested tree across included TeX files with provenance", () => {
  const result = parseLatexSectionTree([
    { path: "main.tex", content: "\\documentclass{article}\n\\section{Intro}\n\\input{chapters/methods}" },
    { path: "chapters/methods.tex", content: "\\subsection{Dataset}\nData here.\n\\subsection{Model}\nModel details." },
  ]);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.files, ["main.tex", "chapters/methods.tex"]);
  assert.equal(result.roots[0]?.title, "Intro");
  assert.equal(result.roots[0]?.children[0]?.title, "Dataset");
  assert.equal(result.roots[0]?.children[0]?.file, "chapters/methods.tex");
  assert.equal(result.roots[0]?.children[0]?.startLine, 1);
});

test("fails safely for missing, circular, and traversal includes", () => {
  const result = parseLatexSectionTree([
    { path: "main.tex", content: "\\section{A}\n\\input{child}\n\\input{../secret}" },
    { path: "child.tex", content: "\\subsection{B}\n\\input{main}" },
  ]);

  assert.equal(result.roots[0]?.children[0]?.title, "B");
  assert.match(result.warnings.join("\n"), /Circular include/);
  assert.match(result.warnings.join("\n"), /Unsafe include path/);
});
