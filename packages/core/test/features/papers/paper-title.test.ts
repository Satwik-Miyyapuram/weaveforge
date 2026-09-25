import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderTitle, titleFromFileName } from "../../../src/features/papers/index.js";

test("isPlaceholderTitle: publisher and attachment names are placeholders", () => {
  for (const t of ["Catalog Page", "SAGE PDF Full Text", "ScienceDirect Full Text PDF", "Full Text PDF", "Preprint PDF", "Snapshot", "", "  ", "Just a moment...", "PDF"]) {
    assert.equal(isPlaceholderTitle(t), true, t);
  }
});

test("isPlaceholderTitle: real titles that share the words are not", () => {
  for (const t of ["Full Text Search at Scale", "Attention Is All You Need", "PDF parsing with transformers", "Catalog of galaxies"]) {
    assert.equal(isPlaceholderTitle(t), false, t);
  }
});

test("titleFromFileName: reads the title out of a Zotero-style filename", () => {
  assert.equal(titleFromFileName("Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf"), "Accurate, Large Minibatch SGD");
  assert.equal(
    titleFromFileName("Kingma and Welling - 2013 - Auto-Encoding Variational Bayes"),
    "Auto-Encoding Variational Bayes",
  );
  assert.equal(titleFromFileName("Locatello - 2019 - Challenging Common Assumptions_ A Study.pdf"), "Challenging Common Assumptions: A Study");
});

test("titleFromFileName: a bare filename loses its extension", () => {
  assert.equal(titleFromFileName("Deep Residual Learning.pdf"), "Deep Residual Learning");
});

test("titleFromFileName: an ordinary title is left alone", () => {
  for (const t of ["Attention Is All You Need", "BYOL - Bootstrap Your Own Latent", "Graph networks: a survey"]) {
    assert.equal(titleFromFileName(t), t);
  }
});
