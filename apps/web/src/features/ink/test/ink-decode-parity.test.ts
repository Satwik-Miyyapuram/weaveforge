import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree exactly on word decoding, so the TS copy can be
// deleted. Lines are seeded so a failure reproduces from the seed.

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

/** Readings that hit each rule: terms, near misses, compounds, splits, numbers, case, Unicode. */
const READINGS = [
  "brown", "lorown", "bown", "softmax", "softrnax", "Softmax", "ablation", "alolation",
  "seedsmatters", "seeds-matters", "seeds matters", "seeds/matters", "dr", "Dr", "aft", "draft",
  "a", "part", "apart", "is", "s", "the", "qzx", "42", "3.14", "—", "", " ", " ",
  "Graph-prior", "graph", "prior", "smith2021", "ΣΟΦΟΣ", "σοφος", "İstanbul", "istanbul",
  "Straße", "strasse", "𝐀lpha", "alpha", "naïve", "naive", "x-y-z", "-ab", "ab-", "attention",
];

const VOCABULARY = [
  "Attention Is All You Need", "Softmax  attention", "Graph-prior models", "smith2021",
  "﻿ablation study", "seeds_matters/again", "ΣΟΦΟΣ", "İstanbul", "x", "",
];

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)]!;
}

function words(rand: () => number): ts.InkWordReadings[] {
  const out: ts.InkWordReadings[] = [];
  const count = Math.floor(rand() * 6);
  for (let i = 0; i < count; i += 1) {
    const candidates = Array.from({ length: Math.floor(rand() * 5) }, () => pick(rand, READINGS));
    const mode = rand();
    const known =
      mode < 0.2
        ? undefined
        : mode < 0.3
          ? null
          : Array.from({ length: candidates.length + (rand() < 0.1 ? 1 : 0) }, () => rand() < 0.5);
    const joinMode = rand();
    const join =
      joinMode < 0.6 ? undefined : joinMode < 0.7 ? null : joinMode < 0.75 ? "  " : pick(rand, READINGS);
    out.push({ candidates, ...(known !== undefined ? { known } : {}), ...(join !== undefined ? { join } : {}) });
  }
  return out;
}

test("decodeInkWords matches TS on seeded lines", () => {
  for (let seed = 1; seed <= 2000; seed += 1) {
    const rand = random(seed);
    const line = words(rand);
    const vocabulary = VOCABULARY.filter(() => rand() < 0.6);
    const engineText = rand() < 0.7 ? ` ${line.map((w) => w.candidates[0] ?? "").join(" ")} ` : undefined;
    assert.deepEqual(
      rs.decodeInkWords(line, vocabulary, engineText),
      ts.decodeInkWords(line, vocabulary, engineText),
      `seed ${seed}`,
    );
  }
});

test("decodeInkWords matches TS on the documented cases", () => {
  const cases: [ts.InkWordReadings[], string[], string?][] = [
    [[{ candidates: ["lorown", "brown", "bown"], known: [false, true, false] }], [], "lorown"],
    [[{ candidates: ["alolation", "alo lation"], known: [false, true] }], ["Ablation study"]],
    [[{ candidates: ["seedsmatters", "seeds-matters"], known: [false, true] }], []],
    [
      [
        { candidates: ["dr"], known: [false], join: "draft" },
        { candidates: ["aft"], known: [true] },
      ],
      [],
      "dr aft",
    ],
    [
      [
        { candidates: ["a"], known: [true], join: "apart" },
        { candidates: ["part"], known: [true], join: "parts" },
        { candidates: ["s"], known: [true] },
      ],
      [],
    ],
    [[{ candidates: [" ", ""] }], [], "  engine  "],
    [[], ["x"]],
  ];
  for (const [line, vocabulary, engineText] of cases) {
    assert.deepEqual(rs.decodeInkWords(line, vocabulary, engineText), ts.decodeInkWords(line, vocabulary, engineText));
  }
});
