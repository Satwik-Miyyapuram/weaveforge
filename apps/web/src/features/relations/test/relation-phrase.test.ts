/** How a relation reads from the paper you are looking at (design D17, DA-120..124). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RELATION_TYPES } from "@weaveforge/core";

import { linkSentence, relationPhrase, sortPapersByTitle } from "../ui/relation-phrase";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("an outgoing relation reads as its label", () => {
  assert.equal(relationPhrase("cites", true), "Cites");
  assert.equal(relationPhrase("builds_on", true), "Builds on");
});

test("an incoming relation reads from this paper's side", () => {
  assert.equal(relationPhrase("cites", false), "Cited by");
  assert.equal(relationPhrase("extends", false), "Extended by");
  assert.equal(relationPhrase("contradicts", false), "Contradicted by");
  assert.equal(relationPhrase("builds_on", false), "Built on by");
  assert.equal(relationPhrase("uses_method", false), "Method used by");
});

test("similar reads the same both ways", () => {
  assert.equal(relationPhrase("similar", false), relationPhrase("similar", true));
});

test("every relation type has an incoming phrase", () => {
  for (const type of RELATION_TYPES) assert.ok(relationPhrase(type, false).length > 0, type);
});

test("the link sentence says what will be saved, and nothing until both papers are picked", () => {
  assert.equal(linkSentence("Attention", "cites", "LSTM"), "Attention cites LSTM");
  assert.equal(linkSentence("A", "uses_method", "B"), "A uses method B");
  assert.equal(linkSentence("", "cites", "B"), null);
  assert.equal(linkSentence("A", "cites", undefined), null);
});

test("papers are listed by title, ignoring case, without changing the input", () => {
  const input = [{ title: "beta" }, { title: "Alpha" }, { title: "gamma" }];
  assert.deepEqual(sortPapersByTitle(input).map((p) => p.title), ["Alpha", "beta", "gamma"]);
  assert.equal(input[0]?.title, "beta");
});

test("the side panel lists every relation behind a Show all toggle and reads direction", () => {
  const src = read("../ui/graph-side-panel.tsx");
  assert.match(src, /relationPhrase\(/);
  assert.match(src, /Show all \$\{touching\.length\}/);
  assert.doesNotMatch(src, /touching\.slice\(0, 8\)\.map/);
});

test("the link form has labelled fields, searchable sorted papers, a preview and a toast", () => {
  const src = read("../ui/add-edge-form.tsx");
  for (const label of ['label="From"', 'label="Relation"', 'label="To"']) assert.ok(src.includes(label), label);
  assert.match(src, /searchable=\{papers\.length > 10\}/);
  assert.match(src, /sortPapersByTitle\(papers\)/);
  assert.match(src, /linkSentence\(/);
  assert.match(src, /showToast\("Linked"\)/);
  assert.match(src, /onAdded\?\.\(from\)/);
  assert.doesNotMatch(src, /<button\b/);
  assert.doesNotMatch(src, /Add edge/);
});

test("after a link the graph selects the paper it starts from", () => {
  const src = read("../ui/graph-screen.tsx");
  assert.match(src, /onAdded=\{\(paperId\) =>/);
});
