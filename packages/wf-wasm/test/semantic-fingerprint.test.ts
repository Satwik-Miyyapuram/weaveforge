import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { documentIdOf, embeddableText, textHash } from "../src/semantic-fingerprint.js";

const pkgDir = new URL("../pkg/", import.meta.url);

before(() => {
  initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });
});

test("text hashes keep the format already stored in browsers", () => {
  assert.equal(textHash(""), "ztntfp.0");
  assert.equal(textHash("a"), "1r9wi7g.1");
  assert.equal(textHash("Attention. Transformers use attention"), "1yrhdce.11");
  assert.equal(textHash("héllo 😀 wörld"), "1qs8wzt.e", "length counts UTF-16 units");
  assert.equal(textHash("x".repeat(300)), "15wcelx.8c");
});

test("passage ids carry their document", () => {
  assert.equal(documentIdOf("note:a#3"), "note:a");
  assert.equal(documentIdOf("note:a"), "note:a", "an unsuffixed id is its own document");
  assert.equal(documentIdOf("pdf:p1:12#0"), "pdf:p1:12", "only the last # is the passage marker");
});

test("embeddable text repeats the title and trims the body", () => {
  assert.equal(
    embeddableText("Attention", ["Transformer"], "  Scaled dot product  "),
    "Attention. Transformer. Scaled dot product",
  );
  assert.equal(embeddableText("Attention", [], "   "), "Attention");
  assert.equal(embeddableText("", ["X"], ""), "X");
});
