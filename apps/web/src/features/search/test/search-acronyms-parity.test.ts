import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust title acronym helper returns exactly what the TS original
// acronymsForTitle in packages/core/src/search/search-acronyms.ts returns.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

// Stop words, capitalised initialisms, Unicode letters and digraphs, digits, punctuation,
// and an astral-plane letter (a UTF-16 surrogate pair).
const WORDS = [
  "Generative", "Adversarial", "Networks", "Deep", "Residual", "Learning", "for", "Image",
  "Recognition", "the", "of", "and", "The", "GAN", "BERT", "DDPM", "β-VAE", "R-CNN", "3D", "42",
  "Ölçü", "émile", "ßtraße", "ǆa", "ǅungla", "Ǆ", "İstanbul", "ΣΊΣΥΦΟΣ", "𐐨pple", "𐐀RAY", "x2",
  "a", "An", "Deep", "Deep", "",
];
const SEPARATORS = [
  " ", "  ", ": ", " — ", " – ", " - ", "-", " ", " ", "﻿", "\n", "\t", ", ", "🙂", " ", "",
];

const TARGETED = [
  "",
  " ",
  "  ﻿",
  "Generative Adversarial Networks",
  "Generative  Adversarial Networks",
  "Learning to Rank with Graphs",
  "Deep Deep Deep Learning",
  "Deep Residual Learning for Image Recognition",
  "BERT: Pre-training of Deep Bidirectional Transformers",
  "Fast R-CNN Object Detection",
  "Ölçü Straße Ǆ",
  "ǆa ǆb ǆc",
  "ß Ölçü émile",
  "𐐨pple 𐐀RAY Tree",
  "İ İ İ İ",
  "DDPM DDPM",
  "BERT BERT BERT",
  "Neural Networks",
  "GAN—Generative Adversarial Networks",
  "A: B C D",
  "Ab: Generative Adversarial Networks",
  "Ab:Generative Adversarial Networks",
  "x\nGenerative Adversarial Networks",
  "Generative Adversarial Networks",
  "1.5 Neural 2x Nets",
  "ABC",
  "ABCDEFGHI",
  "ABCDEFGH",
  "GANs 3D 3D",
  "Cats — and dogs — are: fun",
  "A".repeat(61) + ": Generative Adversarial Networks",
  "Generative Adversarial Networks, the 🙂 Deep Residual Learning for Image Recognition",
];

// TS takes a word's first UTF-16 unit, so an astral initial becomes a lone high surrogate;
// Rust takes the whole char. Where TS has a lone half, compare Rust cut the same way.
// The whole char is one unit longer, so Rust drops an acronym that then passes the cap.
const MAX_ACRONYM_UNITS = 8;
function sameAcronyms(actual: unknown, expected: unknown, label: string): void {
  const rsList = actual as string[];
  const tsList = (expected as string[]).filter(
    (t) => t.length + (t.match(/\p{Cs}/gu)?.length ?? 0) <= MAX_ACRONYM_UNITS,
  );
  const cut = (s: string, t: string) =>
    /\p{Cs}/u.test(t) ? s.replace(/[\u{10000}-\u{10ffff}]/gu, (c) => c.charAt(0)) : s;
  assert.deepEqual(
    rsList.map((s, i) => cut(s, tsList[i] ?? "")),
    tsList,
    label,
  );
}

test("acronymsForTitle matches TS on targeted titles", () => {
  for (const title of TARGETED) {
    sameAcronyms(
      plain(rs.acronymsForTitle(title)),
      plain(ts.acronymsForTitle(title)),
      JSON.stringify(title),
    );
  }
});

test("acronymsForTitle matches TS on seeded titles", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const count = Math.floor(rand() * 8);
    let title = rand() < 0.1 ? pick(rand, SEPARATORS) : "";
    for (let i = 0; i < count; i += 1) {
      title += pick(rand, WORDS) + pick(rand, SEPARATORS);
    }
    sameAcronyms(
      plain(rs.acronymsForTitle(title)),
      plain(ts.acronymsForTitle(title)),
      `seed ${seed}: ${JSON.stringify(title)}`,
    );
  }
});
