import { test } from "node:test";
import assert from "node:assert/strict";

import { damerauLevenshtein, matchVocabulary, spanDistance } from "../application/vocab-match";

test("damerauLevenshtein counts a transposition as one edit", () => {
  assert.equal(damerauLevenshtein("module", "modlue"), 1);
  assert.equal(damerauLevenshtein("graph", "graph"), 0);
  assert.equal(damerauLevenshtein("", "abc"), 3);
  assert.equal(damerauLevenshtein("kitten", "sitting"), 3);
});

test("spanDistance refuses a word further than 2 or a span over 25 %", () => {
  assert.equal(spanDistance(["Graph-prior", "modlue"], ["Graph-prior", "module"]), 1);
  assert.equal(spanDistance(["Grph", "mdle"], ["Graph-prior", "module"]), Infinity);
  assert.equal(spanDistance(["cat"], ["cut"]), Infinity, "3 letters × 25 % rounds down to 0 edits");
  assert.equal(spanDistance(["a", "b"], ["a"]), Infinity);
});

test("a near-miss inside [[…]] becomes the exact title", () => {
  const { text, matches } = matchVocabulary("see [[Graph-prior modlue]] for the proof", ["Graph-prior module"]);
  assert.equal(text, "see [[Graph-prior module]] for the proof");
  assert.deepEqual(matches, [{ from: "Graph-prior modlue", to: "Graph-prior module" }]);
});

test("an alias is kept and only the target is rewritten", () => {
  const { text } = matchVocabulary("[[Grap-prior module|the module]]", ["Graph-prior module"]);
  assert.equal(text, "[[Graph-prior module|the module]]");
});

test("plain words match a multi-word title, keeping punctuation, longest first", () => {
  const { text, matches } = matchVocabulary("Compare graph-pror module, then smith2O21.", [
    "module",
    "Graph-prior module",
    "smith2021",
  ]);
  assert.equal(text, "Compare Graph-prior module, then smith2021.");
  assert.equal(matches.length, 2);
});

test("an exact word is left alone and 'model' does not become 'module'", () => {
  const { text, matches } = matchVocabulary("the model and the module", ["module"]);
  assert.equal(text, "the model and the module");
  assert.equal(matches.length, 0);
});

test("the symbol map rewrites arrows and comparisons between spaces", () => {
  assert.equal(matchVocabulary("x -> y and a <= b", []).text, "x → y and a ≤ b");
  assert.equal(matchVocabulary("a->b", []).text, "a->b", "glued symbols are left to the writer");
});
