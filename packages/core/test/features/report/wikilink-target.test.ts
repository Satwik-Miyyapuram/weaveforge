/**
 * The LaTeX export reads `[[wikilinks]]` with the vault's own parser
 * (xhelp-19), and names figures with the one sanitizer the Overleaf export
 * also uses (xhelp-20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWikilinkInner } from "../../../src/features/vault/domain/vault-page.js";
import { markdownToLatex, uniqueFigureName } from "../../../src/features/report/domain/markdown-to-latex.js";

test("parseWikilinkInner reads target, alias, heading and block", () => {
  assert.deepEqual(parseWikilinkInner("A Paper", "[[A Paper]]"), { target: "A Paper", alias: undefined, raw: "[[A Paper]]" });
  assert.deepEqual(parseWikilinkInner(" A Paper | short ", "r"), { target: "A Paper", alias: "short", raw: "r" });
  assert.deepEqual(parseWikilinkInner("A Paper#Intro|s", "r"), { target: "A Paper", alias: "s", heading: "Intro", raw: "r" });
  assert.deepEqual(parseWikilinkInner("A Paper#^b1", "r"), { target: "A Paper", alias: undefined, block: "b1", raw: "r" });
  assert.deepEqual(parseWikilinkInner("A Paper|", "r"), { target: "A Paper", alias: undefined, raw: "r" });
});

test("a link with a heading or block still cites its paper", () => {
  const citeByTitle = new Map([["a paper", "k1"]]);
  const { latex, warnings } = markdownToLatex("See [[A Paper#Intro|short]] and [[A Paper#^b1]].", { citeByTitle });
  assert.equal((latex.match(/\\cite\{k1\}/g) ?? []).length, 2);
  assert.equal(warnings.length, 0);
});

test("an unresolved link shows its alias, else its target", () => {
  const { latex } = markdownToLatex("[[Gone#H|shown]] and [[Other#H]]", { citeByTitle: new Map() });
  assert.match(latex, /shown/);
  assert.match(latex, /Other/);
  assert.doesNotMatch(latex, /#H/);
});

test("uniqueFigureName sanitizes and numbers collisions before the extension", () => {
  const used = new Set<string>();
  assert.equal(uniqueFigureName("a b.png", used), "a_b.png");
  assert.equal(uniqueFigureName("a b.png", used), "a_b_2.png");
  assert.equal(uniqueFigureName("a?b.png", used), "a_b_3.png");
  assert.equal(uniqueFigureName("fig", used), "fig");
  assert.equal(uniqueFigureName("fig", used), "fig_2");
  assert.equal(uniqueFigureName(".hidden", used), ".hidden");
  assert.equal(uniqueFigureName(".hidden", used), ".hidden_2");
  assert.equal(uniqueFigureName("", used), "figure.bin");
  assert.equal(uniqueFigureName("图.png", used), "_.png");
});

test("markdownToLatex names figures by their file name, deduped", () => {
  // Stored paths never hold spaces, so unsafe characters stand in for them.
  const { images } = markdownToLatex("![a](reportimg:u/s/x?y.png)\n\n![b](reportimg:v/t/x&y.png)\n\n![c](reportimg:)");
  assert.deepEqual(images.map((i) => i.fileName), ["x_y.png", "x_y_2.png"]);
});
