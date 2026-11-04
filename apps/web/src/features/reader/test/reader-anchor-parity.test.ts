import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type {
  CombinedPdfAnchor,
  PdfLocus,
  TextPositionSelector,
  TextQuoteSelector,
  TextSpan,
  ZoteroRectPosition,
} from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust anchor resolution must return exactly what the TS copy returns, so the
// TS copy can be deleted. Texts and quotes are seeded so a failure reproduces.

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

type Rand = () => number;

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function int(rand: Rand, n: number): number {
  return Math.floor(rand() * n);
}

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[int(rand, items.length)]!;
}

// Small pool so quotes repeat. Every entry is whole code points: no lone surrogates.
const WORDS = ["the", "of", "pdf", "ink", "quote", "é", "x"];
const SPACES = [" ", "  ", "\t", "\n", "\r\n", " ", " ", "　", "﻿", "­\n"];
const EMOJI = ["\u{1F600}", "\u{1F389}", "\u{1F44D}\u{1F3FD}"];

/** Words, whitespace runs and emoji, so quotes repeat and whitespace varies. */
function randomText(rand: Rand): string {
  let out = "";
  const count = int(rand, 40);
  for (let i = 0; i < count; i += 1) {
    const kind = rand();
    out += kind < 0.6 ? pick(rand, WORDS) : kind < 0.85 ? pick(rand, EMOJI) : pick(rand, SPACES);
    if (rand() < 0.5) out += pick(rand, SPACES);
  }
  return out;
}

/** Moves `i` back one unit when it would split a surrogate pair. */
function cut(text: string, i: number): number {
  if (i <= 0 || i >= text.length) return i;
  const hi = text.charCodeAt(i - 1);
  const lo = text.charCodeAt(i);
  const splits = hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
  return splits ? i - 1 : i;
}

/** Context just before or after `at`: usually the real neighbour, sometimes a random word. */
function context(rand: Rand, text: string, at: number, isPrefix: boolean): string {
  if (rand() < 0.6) {
    const reach = int(rand, 12);
    if (isPrefix) return text.slice(cut(text, Math.max(0, at - reach)), at);
    return text.slice(at, cut(text, Math.min(text.length, at + reach)));
  }
  return pick(rand, [...WORDS, " ", ""]);
}

/** Exact quote sliced at random code-unit cuts, with prefix/suffix that sometimes match. */
function randomQuote(rand: Rand, text: string): TextQuoteSelector {
  const a = cut(text, int(rand, text.length + 1));
  const b = cut(text, int(rand, text.length + 1));
  const [start, end] = a <= b ? [a, b] : [b, a];
  const exact = rand() < 0.1 ? pick(rand, WORDS) : text.slice(start, end);
  const quote: TextQuoteSelector = { type: "TextQuoteSelector", exact };
  if (rand() < 0.7) quote.prefix = context(rand, text, start, true);
  if (rand() < 0.7) quote.suffix = context(rand, text, end, false);
  return quote;
}

const EDGE = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -0,
  0,
  0.5,
  1.5,
  -0.5,
  2.5,
  1e308,
];

function randomPosition(rand: Rand, length: number): TextPositionSelector {
  const start = rand() < 0.1 ? pick(rand, EDGE) : int(rand, length + 3) - 1;
  const end = rand() < 0.1 ? pick(rand, EDGE) : start + int(rand, 9) - 3;
  return { type: "TextPositionSelector", start, end };
}

function randomSpans(rand: Rand, length: number): TextSpan[] {
  return Array.from({ length: int(rand, 7) }, () => {
    const start = int(rand, length + 1);
    return { start, end: start + int(rand, 4) };
  });
}

const EXACTS = ["", "   ", " ", "the", "ink pdf", "­\n", "\u{1F600}", "  x"];
const HASHES = [undefined, "", "  ", "abc", " abc ", "def"];
const CURRENT_HASHES = ["", " ", "abc", " abc\n", "def"];
const LISTS: (number[][] | undefined)[] = [
  undefined,
  [],
  [[1, 2, 3, 4]],
  [[1, 2, 3]],
  [[1, Number.NaN, 3, 4]],
  [[0, 0, 1, 1], [2, 2, 3, 3]],
  [[Number.POSITIVE_INFINITY, 1, 2, 3]],
];

function randomZotero(rand: Rand): ZoteroRectPosition | undefined {
  if (rand() < 0.3) return undefined;
  const position: ZoteroRectPosition = { pageIndex: pick(rand, [0, 1, 2, -1, 1.5, Number.NaN]) };
  const rects = pick(rand, LISTS);
  const paths = pick(rand, LISTS);
  const nextPageRects = pick(rand, LISTS);
  if (rects !== undefined) position.rects = rects;
  if (paths !== undefined) position.paths = paths;
  if (nextPageRects !== undefined) position.nextPageRects = nextPageRects;
  return position;
}

function randomLocus(rand: Rand): PdfLocus | undefined {
  if (rand() < 0.25) return undefined;
  const text = randomText(rand);
  const quote: TextQuoteSelector =
    rand() < 0.3 ? { type: "TextQuoteSelector", exact: pick(rand, EXACTS) } : randomQuote(rand, text);
  const locus: PdfLocus = { quote };
  if (rand() < 0.5) locus.position = randomPosition(rand, text.length);
  return locus;
}

test("normaliseWhitespace: default, trim true and trim false match on seeded text", () => {
  for (const seed of SEEDS) {
    const text = randomText(random(seed));
    assert.deepEqual(rs.normaliseWhitespace(text), ts.normaliseWhitespace(text), `seed ${seed} default`);
    assert.deepEqual(
      rs.normaliseWhitespace(text, { trim: true }),
      ts.normaliseWhitespace(text, { trim: true }),
      `seed ${seed} trim true`,
    );
    assert.deepEqual(
      rs.normaliseWhitespace(text, { trim: false }),
      ts.normaliseWhitespace(text, { trim: false }),
      `seed ${seed} trim false`,
    );
  }
});

test("normaliseWhitespace: fixed whitespace, emoji, soft-hyphen and combining edge cases", () => {
  const cases = [
    "",
    " ",
    "  　﻿\t\n",
    "a­\nb",
    "a­",
    "­",
    "\u{1F600} é  x",
    "  lead and trail  ",
  ];
  for (const text of cases) {
    for (const options of [undefined, { trim: true }, { trim: false }]) {
      assert.deepEqual(
        rs.normaliseWhitespace(text, options),
        ts.normaliseWhitespace(text, options),
        `edge ${JSON.stringify(text)} ${JSON.stringify(options)}`,
      );
    }
  }
});

test("findQuoteMatches: seeded quotes with prefix and suffix match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const text = randomText(rand);
    const quote = randomQuote(rand, text);
    assert.deepEqual(rs.findQuoteMatches(text, quote), ts.findQuoteMatches(text, quote), `seed ${seed} quote`);
  }
});

test("findQuoteMatches: empty, whitespace-only and bare quotes match", () => {
  const text = "The \u{1F600} ink pdf the ink";
  const quotes: TextQuoteSelector[] = [
    { type: "TextQuoteSelector", exact: "" },
    { type: "TextQuoteSelector", exact: " \n\t" },
    { type: "TextQuoteSelector", exact: "ink" },
    { type: "TextQuoteSelector", exact: "ink", prefix: "", suffix: "" },
    { type: "TextQuoteSelector", exact: "ink", prefix: "The " },
    { type: "TextQuoteSelector", exact: "\u{1F600}", suffix: " ink" },
  ];
  for (const [i, quote] of quotes.entries()) {
    assert.deepEqual(rs.findQuoteMatches(text, quote), ts.findQuoteMatches(text, quote), `fixed quote ${i}`);
  }
});

test("pickNearestMatch: random spans, ties and missing position match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const length = int(rand, 30);
    const matches = randomSpans(rand, length);
    const position = rand() < 0.2 ? undefined : randomPosition(rand, length);
    assert.deepEqual(
      rs.pickNearestMatch(matches, position),
      ts.pickNearestMatch(matches, position),
      `seed ${seed} pick`,
    );
  }
  assert.deepEqual(rs.pickNearestMatch([], undefined), ts.pickNearestMatch([], undefined), "empty");
});

test("resolvePositionSelector: seeded positions and edge-value grid match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const text = randomText(rand);
    const position = randomPosition(rand, text.length);
    assert.deepEqual(
      rs.resolvePositionSelector(text, position),
      ts.resolvePositionSelector(text, position),
      `seed ${seed} position`,
    );
  }
  const text = "a\u{1F600}b c";
  for (const start of EDGE) {
    for (const end of [...EDGE, text.length, text.length + 1]) {
      const position: TextPositionSelector = { type: "TextPositionSelector", start, end };
      assert.deepEqual(
        rs.resolvePositionSelector(text, position),
        ts.resolvePositionSelector(text, position),
        `grid ${start} ${end}`,
      );
    }
  }
});

test("resolveTextAnchor: seeded loci match, quote first then position", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const text = randomText(rand);
    const locus = randomLocus(rand) ?? { quote: randomQuote(rand, text) };
    assert.deepEqual(rs.resolveTextAnchor(text, locus), ts.resolveTextAnchor(text, locus), `seed ${seed} anchor`);
  }
  const text = "ink and ink";
  const miss: PdfLocus = {
    quote: { type: "TextQuoteSelector", exact: "pdf" },
    position: { type: "TextPositionSelector", start: 4, end: 7 },
  };
  const none: PdfLocus = {
    quote: { type: "TextQuoteSelector", exact: "pdf" },
    position: { type: "TextPositionSelector", start: 9, end: 2 },
  };
  assert.deepEqual(rs.resolveTextAnchor(text, miss), ts.resolveTextAnchor(text, miss), "position fallback");
  assert.deepEqual(rs.resolveTextAnchor(text, none), ts.resolveTextAnchor(text, none), "no resolution");
});

test("chooseAnchorStrategy: seeded anchors with and without zotero, locus and hashes", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const anchor: CombinedPdfAnchor = {};
    const hash = pick(rand, HASHES);
    if (hash !== undefined) anchor.contentHash = hash;
    const zotero = randomZotero(rand);
    if (zotero !== undefined) anchor.zoteroPosition = zotero;
    const locus = randomLocus(rand);
    if (locus !== undefined) anchor.locus = locus;
    const current = pick(rand, CURRENT_HASHES);
    assert.deepEqual(
      rs.chooseAnchorStrategy(anchor, current),
      ts.chooseAnchorStrategy(anchor, current),
      `seed ${seed} strategy`,
    );
  }
});

test("chooseAnchorStrategy: every hash pairing with and without zotero and locus", () => {
  const locus: PdfLocus = { quote: { type: "TextQuoteSelector", exact: "ink" } };
  const zotero: ZoteroRectPosition = { pageIndex: 0, rects: [[1, 2, 3, 4]] };
  for (const hash of HASHES) {
    for (const current of CURRENT_HASHES) {
      for (const zoteroPosition of [undefined, zotero]) {
        for (const withLocus of [undefined, locus]) {
          const anchor: CombinedPdfAnchor = { contentHash: hash, zoteroPosition, locus: withLocus };
          const label = `hash ${JSON.stringify(hash)} current ${JSON.stringify(current)} zotero ${!!zoteroPosition} locus ${!!withLocus}`;
          assert.deepEqual(rs.chooseAnchorStrategy(anchor, current), ts.chooseAnchorStrategy(anchor, current), label);
        }
      }
    }
  }
});
