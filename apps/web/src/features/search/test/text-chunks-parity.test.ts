import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust chunker matches packages/core/src/search/text-chunks.ts, with offsets in
// UTF-16 units. Astral inputs are kept where a cut cannot split a surrogate pair (see the
// astral seeds); lone surrogates are a known gap and are not fed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

type Options = NonNullable<Parameters<typeof ts.chunkForEmbedding>[1]>;

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

const SEPARATORS = [" ", "  ", "\n", "\n\n", "\n \n\t", "\t", " ", " ", "﻿", " "];
const BMP_WORDS = ["a", "é", "ǆ", "ß", "ǅ", "Ölçü", "x".repeat(30), "word", "naïve", "ﬁ", "é"];
const ASTRAL_WORDS = ["😀", "𝒜", "😀😀", "a😀", "𝒜b", "é"];

function randomText(rand: () => number, words: readonly string[], seps: readonly string[]): string {
  let text = rand() < 0.2 ? pick(rand, seps) : "";
  const count = Math.floor(rand() * 60);
  for (let i = 0; i < count; i += 1) {
    text += (i > 0 ? pick(rand, seps) : "") + pick(rand, words);
  }
  return rand() < 0.2 ? text + pick(rand, seps) : text;
}

const check = (text: string, options?: Options, label = ""): void => {
  assert.deepEqual(
    plain(rs.chunkForEmbedding(text, options)),
    plain(ts.chunkForEmbedding(text, options)),
    `${label} ${JSON.stringify({ text, options })}`,
  );
};

test("chunkForEmbedding matches TS on seeded BMP text with random options", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const text = randomText(rand, BMP_WORDS, SEPARATORS);
    const options: Options = {
      maxChars: pick(rand, [1, 2, 5, 10, 20, 50, 200, 1000]),
      overlapChars: pick(rand, [0, 1, 3, 10, 120]),
      minChars: pick(rand, [0, 1, 5, 80]),
    };
    check(text, options, `seed ${seed}`);
    check(text, undefined, `default seed ${seed}`);
  }
});

test("chunkForEmbedding matches TS on seeded astral text (no overlap, cuts never split pairs)", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const rand = random(seed);
    const text = randomText(rand, ASTRAL_WORDS, [" ", "\n", "\n\n", "  "]);
    const options: Options = {
      maxChars: pick(rand, [6, 10, 11, 20, 50, 1000]),
      overlapChars: 0,
      minChars: pick(rand, [0, 1]),
    };
    check(text, options, `astral seed ${seed}`);
  }
});

test("chunkForEmbedding matches TS on blank, whitespace-only and BOM/NBSP/NEL input", () => {
  for (const text of ["", " ", "   ", "\n\n\t", "﻿", "    ", "\u0085", " ", " \u{FEFF} \n"]) {
    check(text);
    check(text, { maxChars: 1, overlapChars: 0, minChars: 0 });
  }
});

test("chunkForEmbedding matches TS on emoji and astral text at short and boundary lengths", () => {
  check("  hello \u{1F600}\n");
  check("😀 aaaa 😀 bbbb 😀 cccc", { maxChars: 10, overlapChars: 0, minChars: 0 });
  check("😀😀😀😀😀😀😀😀", { maxChars: 6, overlapChars: 0, minChars: 0 });
  check("😀 😀 😀 😀", { maxChars: 4, overlapChars: 0, minChars: 0 });
});

test("chunkForEmbedding matches TS on very long words and long unbroken runs", () => {
  check("x".repeat(2500));
  check("x".repeat(2500), { maxChars: 100, overlapChars: 10, minChars: 5 });
  check(`${"y".repeat(40)} ${"z".repeat(3000)}`, { maxChars: 500, overlapChars: 120, minChars: 80 });
  check(`${"w".repeat(999)}\n\n${"v".repeat(999)}`);
});

test("chunkForEmbedding matches TS on paragraphs and newline runs", () => {
  check("first para here.\n\nsecond para", { maxChars: 20, overlapChars: 0, minChars: 5 });
  check("a\n\n\n\nb", { maxChars: 2, overlapChars: 0, minChars: 0 });
  check(`${"Lorem ipsum dolor sit amet. ".repeat(30)}\n\n\n${"Sed ut perspiciatis. ".repeat(30)}`);
});

test("chunkForEmbedding matches TS on size and overlap edge values", () => {
  const text = "aaaa bbbb cccc dddd";
  check(text, { maxChars: text.length, overlapChars: 0, minChars: 0 });
  check(text, { maxChars: text.length - 1, overlapChars: 0, minChars: 0 });
  check(text, { maxChars: 0, overlapChars: 0, minChars: 0 });
  check(text, { maxChars: 10, overlapChars: 10, minChars: 0 });
  check(text, { maxChars: 10, overlapChars: 500, minChars: 0 });
  check(text, { maxChars: 10, overlapChars: 0, minChars: 500 });
  check(text, { maxChars: 10, overlapChars: 3, minChars: 0 });
  check(text, { maxChars: 4, overlapChars: 2, minChars: 0 });
  check(text, { maxChars: 1, overlapChars: 0, minChars: 0 });
  check(text, { maxChars: 1000, overlapChars: 0, minChars: 0 });
});

test("chunkForEmbedding matches TS on short trailing scraps being folded", () => {
  check("aaaa bbbb cccc d", { maxChars: 10, overlapChars: 0, minChars: 8 });
  check("aaaa bbbb cccc d", { maxChars: 10, overlapChars: 0, minChars: 1 });
});
