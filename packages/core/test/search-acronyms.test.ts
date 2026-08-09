import { test } from "node:test";
import assert from "node:assert/strict";
import { acronymsForTitle } from "../src/search/search-acronyms.js";

const has = (title: string, acronym: string) =>
  acronymsForTitle(title).includes(acronym);

test("acronyms: the canonical initialisms researchers actually type", () => {
  assert.ok(has("Generative Adversarial Networks", "gan"));
  assert.ok(has("Denoising Diffusion Probabilistic Models", "ddpm"));
  assert.ok(has("Neural Message Passing for Quantum Chemistry", "nmpqc"));
});

test("acronyms: grammar words are skipped", () => {
  // "for" must not become an initial, or nobody's acronym matches.
  assert.ok(has("Generative Adversarial Networks for Images", "gani"));
  assert.ok(!has("Generative Adversarial Networks for Images", "ganfi"));
});

test("acronyms: a title's own initialism is indexed", () => {
  // One word, so the word-count rule would never produce it — but it is
  // exactly what someone types.
  assert.ok(has("β-VAE: Learning Basic Visual Concepts", "vae"));
  assert.ok(has("BERT: Pre-training of Deep Bidirectional Transformers", "bert"));
});

test("acronyms: the descriptive half after a colon is ignored", () => {
  // "SHORTNAME: the long descriptive part" is the dominant paper-title shape,
  // and the initials of the descriptive half are not a handle anyone uses.
  const out = acronymsForTitle("BERT: Pre-training of Deep Bidirectional Transformers");
  assert.ok(out.includes("bert"));
  assert.ok(!out.includes("pdbt"), `unexpected ${JSON.stringify(out)}`);
});

test("acronyms: long titles also get their leading initials", () => {
  assert.ok(has("Deep Residual Learning for Image Recognition Networks", "drli"));
});

test("acronyms: nothing meaningless is produced", () => {
  assert.deepEqual(acronymsForTitle(""), []);
  assert.deepEqual(acronymsForTitle("Notes"), []);
  // Two significant words cannot make a three-letter handle.
  assert.deepEqual(acronymsForTitle("The Report"), []);
});

test("acronyms: an absurdly long title yields no absurd acronym", () => {
  const title = Array.from({ length: 20 }, (_, i) => `Word${i}`).join(" ");
  for (const acronym of acronymsForTitle(title)) {
    assert.ok(acronym.length <= 8, `produced a ${acronym.length}-character acronym`);
  }
});
