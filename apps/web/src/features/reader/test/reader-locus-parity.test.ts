import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust locus deep-link codec returns exactly what the TS originals in
// packages/core/src/reader/locus-link.ts return: encode, decode, length limits, legacy links.
// Seeded, so a failure reproduces from the seed.

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

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** Inclusive integer in `lo..hi`; never yields -0. */
function int(rand: () => number, lo: number, hi: number): number {
  return Math.floor(rand() * (hi - lo + 1)) + lo;
}

type Locus = Parameters<typeof ts.encodeLocus>[0];

/** Code-point-safe pool: ASCII, accented Latin, CJK, JSON-escaped and percent characters. */
const TEXT_POOL: readonly string[] = [
  "a", "Z", "0", " ", ",", ":", "{", "}", "[", "]",
  "é", "Ü", "ß", "東", "京", "語",
  '"', "\\", "\n", "\t", "%", "+",
];

function randomText(rand: () => number, min: number, max: number): string {
  const length = int(rand, min, max);
  let out = "";
  for (let i = 0; i < length; i += 1) out += pick(rand, TEXT_POOL);
  return out;
}

function randomLocus(rand: () => number): Locus {
  const quote: Locus["quote"] = { type: "TextQuoteSelector", exact: randomText(rand, 1, 60) };
  if (rand() < 0.6) quote.prefix = randomText(rand, 0, 40);
  if (rand() < 0.6) quote.suffix = randomText(rand, 0, 40);
  const locus: Locus = { quote };
  if (rand() < 0.7) {
    const start = int(rand, 0, 5000);
    locus.position = { type: "TextPositionSelector", start, end: start + int(rand, 0, 500) };
  }
  return locus;
}

const VALID = '{"quote":{"type":"TextQuoteSelector","exact":"a"}}';

/** Encoded JSON compared by parsed value; key order and whitespace are not part of the contract. */
function assertEncodeParity(locus: Locus, label: string): void {
  assert.deepEqual(JSON.parse(rs.encodeLocus(locus)), JSON.parse(ts.encodeLocus(locus)), label);
}

function assertDecodeParity(raw: string | null | undefined, label: string): void {
  assert.deepEqual(rs.decodeLocus(raw), ts.decodeLocus(raw), label);
}

// --- encodeLocus ---

test("encodeLocus: Rust and TS agree on seeded loci", () => {
  for (const seed of SEEDS) {
    assertEncodeParity(randomLocus(random(seed)), `seed ${seed}`);
  }
});

test("encodeLocus: Rust and TS agree on clamped fields and the quote-only fallback", () => {
  const long = "a".repeat(2500);
  const quotes = '"'.repeat(2000);
  const loci: Locus[] = [
    { quote: { type: "TextQuoteSelector", exact: long, prefix: long, suffix: long } },
    {
      quote: { type: "TextQuoteSelector", exact: "a".repeat(2000) },
      position: { type: "TextPositionSelector", start: 0, end: 0 },
    },
    { quote: { type: "TextQuoteSelector", exact: "a".repeat(1999), prefix: "", suffix: "" } },
    {
      quote: { type: "TextQuoteSelector", exact: quotes, prefix: quotes, suffix: quotes },
      position: { type: "TextPositionSelector", start: 1, end: 2 },
    },
    {
      quote: { type: "TextQuoteSelector", exact: "東".repeat(2500) },
      position: {
        type: "TextPositionSelector",
        start: Number.MAX_SAFE_INTEGER,
        end: Number.MAX_SAFE_INTEGER,
      },
    },
    {
      quote: { type: "TextQuoteSelector", exact: "x", prefix: "p".repeat(2000) },
      position: { type: "TextPositionSelector", start: 0, end: 5 },
    },
  ];
  loci.forEach((locus, i) => assertEncodeParity(locus, `fixed locus ${i}`));
});

test("encodeLocus: Rust and TS agree on null optional fields and empty exact", () => {
  const withNulls = {
    quote: { type: "TextQuoteSelector", exact: "a", prefix: null, suffix: null },
  } as unknown as Locus;
  const emptyExact = { quote: { type: "TextQuoteSelector", exact: "" } } as Locus;
  assertEncodeParity(withNulls, "null optional fields");
  assertEncodeParity(emptyExact, "empty exact");
});

// --- round trip ---

test("round trip: Rust and TS decode each other's encodings the same way", () => {
  for (const seed of SEEDS) {
    const locus = randomLocus(random(seed));
    const tsRaw = ts.encodeLocus(locus);
    const rsRaw = rs.encodeLocus(locus);
    const expected = ts.decodeLocus(tsRaw);
    assert.deepEqual(rs.decodeLocus(rsRaw), expected, `seed ${seed} rs(rs)`);
    assert.deepEqual(rs.decodeLocus(tsRaw), expected, `seed ${seed} rs(ts)`);
    assert.deepEqual(ts.decodeLocus(rsRaw), expected, `seed ${seed} ts(rs)`);
  }
});

// --- decodeLocus ---

test("decodeLocus: Rust and TS agree on null, undefined and empty input", () => {
  assertDecodeParity(null, "null");
  assertDecodeParity(undefined, "undefined");
  assertDecodeParity("", "empty");
});

const GARBAGE: readonly string[] = [
  " ", "\n", "not json", "{", "}", "[", "]", "null", "undefined", "NaN", "Infinity",
  "42", "-1", "true", "false", '"quote"', "[]", "{}", "[{}]", '{"quote":', '{"quote"}',
  "%", "%7B", "%7B%22quote%22%3A%7B%7D%7D", "%E6%9D%B1", "\u0000", "{'quote':{}}",
  "﻿" + VALID, "\n" + VALID + "\n", " " + VALID, VALID + "}", VALID + "x",
];

test("decodeLocus: Rust and TS agree on garbage strings", () => {
  for (const raw of GARBAGE) assertDecodeParity(raw, `garbage ${JSON.stringify(raw)}`);
});

const QUOTE = '"quote":{"type":"TextQuoteSelector","exact":"a"}';
const POS = (body: string): string =>
  `{${QUOTE},"position":{"type":"TextPositionSelector",${body}}}`;

const WRONG_TYPES: readonly string[] = [
  '{"quote":{"type":"TextQuoteSelector","exact":5}}',
  '{"quote":{"type":"TextQuoteSelector","exact":null}}',
  '{"quote":{"type":"TextQuoteSelector","exact":["a"]}}',
  '{"quote":{"type":"TextQuoteSelector","exact":"a","prefix":5}}',
  '{"quote":{"type":"TextQuoteSelector","exact":"a","prefix":null}}',
  '{"quote":{"type":"TextQuoteSelector","exact":"a","suffix":false}}',
  '{"quote":{"type":"Other","exact":"a"}}',
  '{"quote":{"exact":"a"}}',
  '{"quote":["TextQuoteSelector"]}',
  '{"quote":"TextQuoteSelector"}',
  '{"quote":null}',
  '{"quote":{"type":"TextQuoteSelector","exact":""}}',
  '{"quote":{"type":"TextQuoteSelector","exact":"東京","prefix":""}}',
  `{${QUOTE},"position":null}`,
  `{${QUOTE},"position":"0-1"}`,
  `{${QUOTE},"position":[0,1]}`,
  `{${QUOTE},"position":{"type":"Other","start":0,"end":1}}`,
  POS('"start":"0","end":"1"'),
  POS('"start":null,"end":1'),
  POS('"start":0'),
  POS('"start":-1,"end":3'),
  POS('"start":5,"end":2'),
  POS('"start":-0,"end":0'),
  POS('"start":1.5,"end":2.5'),
  POS('"start":3,"end":3'),
];

test("decodeLocus: Rust and TS agree on wrong types, bad positions and missing fields", () => {
  for (const raw of WRONG_TYPES) assertDecodeParity(raw, `wrong type ${raw}`);
});

test("decodeLocus: Rust and TS agree on the 8000 UTF-16 unit and 2000 field limits", () => {
  assertDecodeParity(VALID + " ".repeat(8000 - VALID.length), "8000 units");
  assertDecodeParity(VALID + " ".repeat(8001 - VALID.length), "8001 units");

  // Multibyte text: the limit counts UTF-16 units, not UTF-8 bytes.
  const cjk = '{"quote":{"type":"TextQuoteSelector","exact":"' + "東".repeat(2000) + '"}}';
  assertDecodeParity(cjk + " ".repeat(8000 - cjk.length), "8000 units, multibyte");
  assertDecodeParity(cjk + " ".repeat(8001 - cjk.length), "8001 units, multibyte");

  const exact = (n: number): string =>
    '{"quote":{"type":"TextQuoteSelector","exact":"' + "a".repeat(n) + '"}}';
  assertDecodeParity(exact(2000), "exact 2000");
  assertDecodeParity(exact(2001), "exact 2001");
  assertDecodeParity(
    '{"quote":{"type":"TextQuoteSelector","exact":"a","prefix":"' + "b".repeat(2001) + '"}}',
    "prefix 2001",
  );
  assertDecodeParity(
    '{"quote":{"type":"TextQuoteSelector","exact":"a","suffix":"' + "b".repeat(2000) + '"}}',
    "suffix 2000",
  );
});

test("decodeLocus: Rust and TS agree on every truncation of seeded encodings", () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const raw = ts.encodeLocus(randomLocus(random(seed)));
    for (let i = 0; i <= raw.length; i += 1) {
      assertDecodeParity(raw.slice(0, i), `seed ${seed} truncated at ${i}`);
    }
  }
});

const CORRUPT_CHARS: readonly string[] = [
  '"', "{", "}", "[", "]", ",", ":", "x", "0", "-", "e", "\\", " ", "%", "東",
];

test("decodeLocus: Rust and TS agree on seeded corrupted encodings", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const raw = ts.encodeLocus(randomLocus(rand));
    const at = int(rand, 0, raw.length - 1);
    const replaced = raw.slice(0, at) + pick(rand, CORRUPT_CHARS) + raw.slice(at + 1);
    const deleted = raw.slice(0, at) + raw.slice(at + 1);
    assertDecodeParity(replaced, `seed ${seed} replaced ${at}`);
    assertDecodeParity(deleted, `seed ${seed} deleted ${at}`);
  }
});

test("decodeLocus: Rust and TS agree on percent-encoded legacy links", () => {
  for (const seed of SEEDS) {
    const raw = ts.encodeLocus(randomLocus(random(seed)));
    assertDecodeParity(encodeURIComponent(raw), `seed ${seed} once`);
    assertDecodeParity(encodeURIComponent(encodeURIComponent(raw)), `seed ${seed} twice`);
  }
});

test("encodeLocus and decodeLocus: Rust and TS agree on overflowing quote fields", () => {
  const quotes = '"'.repeat(2000);
  const locus: Locus = {
    quote: { type: "TextQuoteSelector", exact: quotes, prefix: quotes, suffix: quotes },
    position: { type: "TextPositionSelector", start: 4, end: 9 },
  };
  assertEncodeParity(locus, "overflow encode");
  assertDecodeParity(ts.encodeLocus(locus), "overflow decode of ts output");
  assertDecodeParity(rs.encodeLocus(locus), "overflow decode of rs output");
});
