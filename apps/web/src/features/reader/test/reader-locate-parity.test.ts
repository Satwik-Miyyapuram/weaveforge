import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust reader locate and annotation functions return exactly what the TS originals in
// packages/core/src/reader/ return: lasso hit-tests, document search, match stepping, annotation
// type guards and the keyboard command map. Seeded, so a failure reproduces from the seed.

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

/** Each code point upper or lower by coin flip; code-point spread never yields a lone surrogate. */
function randomCase(rand: () => number, s: string): string {
  return [...s].map((ch) => (rand() < 0.5 ? ch.toUpperCase() : ch.toLowerCase())).join("");
}

/** `Object.is` for scalars, so NaN and -0 count. */
function sameNumber(a: number, b: number, label: string): void {
  assert.ok(Object.is(a, b), `${label}: ts ${a} rs ${b}`);
}

// --- Lasso: pointInPolygon, inkPathsInPolygon ---

/** A coordinate, often on the integer grid so edges and vertices line up exactly. */
function coord(rand: () => number): number {
  if (rand() < 0.03) return Number.NaN;
  if (rand() < 0.25) return Math.round(rand() * 20 - 10);
  return rand() * 200 - 100;
}

function polygonFor(rand: () => number): number[] {
  const vertices = 3 + Math.floor(rand() * 6);
  const flat: number[] = [];
  for (let i = 0; i < vertices * 2; i += 1) flat.push(coord(rand));
  return flat;
}

/** Too short, odd-length, closed, degenerate, non-finite and -0 vertices. */
const POLYGON_EDGES: readonly (readonly number[])[] = [
  [],
  [0, 0],
  [0, 0, 10, 0],
  [0, 0, 10, 0, 5, 10, 99],
  [0, 0, 10, 0, 10, 10, 0, 10],
  [0, 0, 10, 0, 10, 10, 0, 10, 0, 0],
  [0, 0, 0, 0, 0, 0],
  [-0, -0, 10, -0, 5, 10],
  [0, 0, 10, 0, 5, Number.NaN],
  [0, 0, 10, 0, 5, Number.POSITIVE_INFINITY],
  [0, 0, 1e308, 0, 0, 1e308],
];

const POINT_EDGES: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0, -0],
  [10, 0],
  [5, 5],
  [5, 10],
  [10, 10],
  [0, 10],
  [0, 5],
  [10, 5],
  [0.5, 0.5],
  [Number.NaN, 0],
  [0, Number.NaN],
  [Number.POSITIVE_INFINITY, 0],
  [Number.NEGATIVE_INFINITY, 5],
  [1e308, 1e308],
];

test("pointInPolygon: Rust and TS agree on fixed edge polygons and points", () => {
  for (const polygon of POLYGON_EDGES) {
    for (const [x, y] of POINT_EDGES) {
      assert.equal(
        rs.pointInPolygon(polygon, x, y),
        ts.pointInPolygon(polygon, x, y),
        `polygon ${JSON.stringify(polygon)} point ${x},${y}`,
      );
    }
  }
});

test("pointInPolygon: Rust and TS agree on seeded polygons and points", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const polygon = polygonFor(rand);
    for (let i = 0; i < 20; i += 1) {
      const x = coord(rand);
      const y = coord(rand);
      assert.equal(
        rs.pointInPolygon(polygon, x, y),
        ts.pointInPolygon(polygon, x, y),
        `seed ${seed} point ${i}`,
      );
    }
  }
});

/** `undefined` takes the default share in both implementations. */
const SHARES: readonly (number | undefined)[] = [undefined, 0, 0.5, 0.6, 1, -1, 2, Number.NaN];

/** Up to four strokes of up to 30 points; some odd-length, some non-finite. */
function pathsFor(rand: () => number): number[][] {
  const count = Math.floor(rand() * 5);
  const paths: number[][] = [];
  for (let p = 0; p < count; p += 1) {
    const length = Math.floor(rand() * 30) * 2 + (rand() < 0.1 ? 1 : 0);
    const path: number[] = [];
    for (let i = 0; i < length; i += 1) path.push(coord(rand));
    paths.push(path);
  }
  return paths;
}

test("inkPathsInPolygon: Rust and TS agree on seeded strokes, loops and shares", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const paths = pathsFor(rand);
    const polygon = polygonFor(rand);
    const share = SHARES[seed % SHARES.length];
    assert.equal(
      rs.inkPathsInPolygon(paths, polygon, share),
      ts.inkPathsInPolygon(paths, polygon, share),
      `seed ${seed} share ${share}`,
    );
  }
});

test("inkPathsInPolygon: Rust and TS agree on empty, non-finite and edge polygon inputs", () => {
  const pathSets: number[][][] = [
    [],
    [[]],
    [[Number.NaN, Number.NaN]],
    [[0, 0]],
    [[5, 5, 5, 10]],
    [[0, 0, 10, 0, 5, 5]],
  ];
  for (const paths of pathSets) {
    for (const polygon of POLYGON_EDGES) {
      for (const share of SHARES) {
        assert.equal(
          rs.inkPathsInPolygon(paths, polygon, share),
          ts.inkPathsInPolygon(paths, polygon, share),
          `paths ${JSON.stringify(paths)} polygon ${JSON.stringify(polygon)} share ${share}`,
        );
      }
    }
  }
});

// --- Document search: findDocumentMatches ---

/** Mixed case, emoji, combining marks, whitespace-like code points, Turkish and Greek case folds. */
const WORDS = [
  "Alpha",
  "beta",
  "GAMMA",
  "de lta",
  "x y",
  "　",
  "﻿",
  "😀",
  "été",
  "İstanbul",
  "ΟΔΟΣ",
  "wf",
  "\tTab",
  "ÄÖÜ",
  "ß",
];

const SEPARATORS = [" ", "\n", "\t", " ", "", " ", "  "];

/** Queries that trim to nothing. */
const QUERY_BLANKS = ["", " ", "   ", "\t", " ", "　", "﻿", "\n \t", " "];

function pagesFor(rand: () => number): { pageIndex: number; text: string }[] {
  const count = Math.floor(rand() * 5);
  const pages: { pageIndex: number; text: string }[] = [];
  for (let p = 0; p < count; p += 1) {
    let text = "";
    const words = Math.floor(rand() * 25);
    for (let w = 0; w < words; w += 1) {
      text += pick(rand, WORDS) + pick(rand, SEPARATORS);
    }
    pages.push({ pageIndex: rand() < 0.3 ? p * 3 : p, text });
  }
  return pages;
}

function queriesFor(rand: () => number): string[] {
  const word = pick(rand, WORDS);
  const other = pick(rand, WORDS);
  return [
    word, // hit when the word is on a page
    randomCase(rand, word), // case variant
    word.toUpperCase(),
    word.toLowerCase(),
    `${word}${pick(rand, SEPARATORS)}${other}`, // two-word phrase, may miss
    `  ${word}  `, // padded: trimmed before search
    pick(rand, QUERY_BLANKS), // empty or whitespace-only
    "zzq-miss", // miss
  ];
}

test("findDocumentMatches: Rust and TS agree on seeded multi-page texts and queries", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const pages = pagesFor(rand);
    for (const query of queriesFor(rand)) {
      assert.deepEqual(
        rs.findDocumentMatches(pages, query),
        ts.findDocumentMatches(pages, query),
        `seed ${seed} query ${JSON.stringify(query)}`,
      );
    }
  }
});

test("findDocumentMatches: Rust and TS agree on fixed folds, blanks and empty pages", () => {
  const pages = [
    { pageIndex: 0, text: "ΟΔΟΣ οδος İstanbul" },
    { pageIndex: 4, text: "" },
    { pageIndex: 7, text: "😀 x 😀" },
  ];
  const queries = [
    "ΟΔΟΣ",
    "οδος",
    "οδοσ",
    "İ",
    "istanbul",
    "😀",
    "x ",
    "",
    " ",
    "﻿",
    "　ΟΔΟΣ ",
    "missing",
  ];
  for (const query of queries) {
    assert.deepEqual(
      rs.findDocumentMatches(pages, query),
      ts.findDocumentMatches(pages, query),
      `fixed query ${JSON.stringify(query)}`,
    );
  }
  assert.deepEqual(rs.findDocumentMatches([], "a"), ts.findDocumentMatches([], "a"), "no pages");
});

// --- Match stepping: nextMatchIndex ---

test("nextMatchIndex: Rust and TS agree on every count and cursor, both directions", () => {
  const totals = [0, 1, 2, 3, 8, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e308];
  for (const total of totals) {
    const currents = [
      -2,
      -1,
      0,
      1,
      2,
      total - 1,
      total,
      total + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const current of currents) {
      for (const direction of [1, -1] as const) {
        sameNumber(
          rs.nextMatchIndex(current, total, direction),
          ts.nextMatchIndex(current, total, direction),
          `current ${current} total ${total} dir ${direction}`,
        );
      }
    }
  }
});

test("nextMatchIndex: Rust and TS agree on seeded counts and cursors", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const total = Math.floor(rand() * 12) - 1;
    const current = Math.floor(rand() * 16) - 2 + (rand() < 0.1 ? 0.5 : 0);
    const direction: 1 | -1 = rand() < 0.5 ? 1 : -1;
    sameNumber(
      rs.nextMatchIndex(current, total, direction),
      ts.nextMatchIndex(current, total, direction),
      `seed ${seed} current ${current} total ${total} dir ${direction}`,
    );
  }
});

// --- Annotation type and sync-state guards ---

const ANNOTATION_TYPES = ["highlight", "underline", "note", "image", "ink", "text"] as const;

const ANNOTATION_TYPE_EDGES: readonly string[] = [
  ...ANNOTATION_TYPES,
  "strikeout",
  "strikeOut",
  "",
  " ",
  " ink",
  "ink ",
  "inks",
  "Highlight",
  "HIGHLIGHT",
  "Note",
  "INK",
  "toString",
  "constructor",
  "__proto__",
];

const SYNC_STATE_EDGES: readonly string[] = [
  "local",
  "synced",
  "pending",
  "conflict",
  "deleted",
  "conflicted",
  "",
  " pending",
  "Local",
  "SYNCED",
  "Conflict",
  "toString",
  "__proto__",
];

test("isReaderAnnotationType: Rust and TS agree on valid types, strikeout, blanks and case", () => {
  for (const value of ANNOTATION_TYPE_EDGES) {
    assert.equal(
      rs.isReaderAnnotationType(value),
      ts.isReaderAnnotationType(value),
      `type ${JSON.stringify(value)}`,
    );
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const value = randomCase(rand, pick(rand, [...ANNOTATION_TYPES, "strikeout"]));
    assert.equal(
      rs.isReaderAnnotationType(value),
      ts.isReaderAnnotationType(value),
      `seed ${seed} type ${JSON.stringify(value)}`,
    );
  }
});

test("isAnnotationSyncState: Rust and TS agree on valid states, blanks and case", () => {
  for (const value of SYNC_STATE_EDGES) {
    assert.equal(
      rs.isAnnotationSyncState(value),
      ts.isAnnotationSyncState(value),
      `state ${JSON.stringify(value)}`,
    );
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const value = randomCase(rand, pick(rand, ["local", "synced", "pending", "conflict"]));
    assert.equal(
      rs.isAnnotationSyncState(value),
      ts.isAnnotationSyncState(value),
      `seed ${seed} state ${JSON.stringify(value)}`,
    );
  }
});

// --- Keyboard: readerKeyboardCommand ---

/**
 * Every key the TS function names, plus `"a"` and an absent key. `undefined` is outside
 * `ReaderKeyEvent` but reaches the wrapper at runtime, so it is cast in the call below.
 */
const KEYS: readonly (string | undefined)[] = [
  "+",
  "=",
  "Add",
  "-",
  "_",
  "Subtract",
  "r",
  "R",
  "0",
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "PageDown",
  "PageUp",
  "j",
  "k",
  "Home",
  "End",
  "a",
  undefined,
];

const CODES: readonly (string | undefined)[] = [
  undefined,
  "NumpadAdd",
  "NumpadSubtract",
  "Equal",
  "Minus",
  "Digit0",
  "Numpad0",
];

test("readerKeyboardCommand: Rust and TS agree on every key, code and modifier combination", () => {
  for (const key of KEYS) {
    for (const code of CODES) {
      for (let mask = 0; mask < 16; mask += 1) {
        const event = {
          key: key as string,
          code,
          ctrlKey: (mask & 1) !== 0,
          metaKey: (mask & 2) !== 0,
          altKey: (mask & 4) !== 0,
          fromEditable: (mask & 8) !== 0,
        };
        assert.deepEqual(
          rs.readerKeyboardCommand(event),
          ts.readerKeyboardCommand(event),
          `key ${String(key)} code ${String(code)} mask ${mask}`,
        );
      }
    }
  }
});
