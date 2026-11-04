import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import {
  furnitureKey as tsFurnitureKey,
  isBoldFont as tsIsBoldFont,
} from "../../../../../../packages/core/src/features/reader/analysis/line-reconstruction.js";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust reader line-reconstruction functions return exactly what the TS originals in
// packages/core/src/features/reader/analysis/ return: page text, bold faces, running-head keys,
// visual lines, column detection and reading order. Seeded, so a failure reproduces from the seed.

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

type Item = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  fontName?: string;
};

// --- Generators: pdf.js-shaped text items on a 612 x 792 page ---

const FONTS: readonly (string | undefined)[] = [
  "g_d0_f1",
  "Times-Bold",
  "ABCDEF+Arial-BoldMT",
  "Helvetica",
  undefined,
  "Georgia-Heavy",
  "Arial-Black",
  "Times-Italic",
  "",
  "g_d1_f7-Bold",
];

/** Words, hyphenated pieces, empty and blank strings, a ligature, emoji and a tab. */
const WORDS = [
  "Alpha",
  "beta",
  "well-",
  "known",
  "co-",
  "x",
  "2019",
  "et",
  "al.",
  "naïve",
  "[12]",
  "α-β",
  "😀",
  "",
  "  ",
  "\tTab",
  "ﬁeld",
];

const SEPARATORS = [" ", " ", "  ", ""];

/** One run: 1 to 3 words, a transform at `(x, y)`, optional `hasEOL` and `fontName`. */
function runFor(rand: () => number, x: number, y: number, size: number): Item {
  const words = 1 + Math.floor(rand() * 3);
  let str = "";
  for (let w = 0; w < words; w += 1) {
    str += (w > 0 ? pick(rand, SEPARATORS) : "") + pick(rand, WORDS);
  }
  const item: Item = {
    str,
    transform: [size, 0, 0, size, x, y],
    width: rand() < 0.05 ? 0 : Math.round(str.length * size * 0.5 * 10) / 10,
    height: size,
  };
  const eol = rand();
  if (eol < 0.4) item.hasEOL = eol < 0.2;
  const font = pick(rand, FONTS);
  if (font !== undefined) item.fontName = font;
  return item;
}

/** Rows of runs, one or two columns, same-baseline runs, superscripts and the odd heading. */
function pageItemsFor(rand: () => number): Item[] {
  const twoColumns = rand() < 0.4;
  const rows = Math.floor(rand() * 40);
  const items: Item[] = [];
  for (let row = 0; row < rows; row += 1) {
    const baseline = 752 - row * 12;
    const runs = 1 + Math.floor(rand() * 3);
    for (let r = 0; r < runs; r += 1) {
      const column = twoColumns && rand() < 0.5 ? 1 : 0;
      const x = column === 0 ? 40 + Math.round(rand() * 250) : 320 + Math.round(rand() * 240);
      items.push(runFor(rand, x, baseline, rand() < 0.7 ? 10 : 12));
    }
    if (rand() < 0.15) items.push(runFor(rand, 40 + Math.round(rand() * 500), baseline + 4, 6));
    if (rand() < 0.05) items.push(runFor(rand, 72, baseline, 18));
  }
  return items;
}

/** Left column then right column, so a right run never joins the left column's last line. */
function twoColumnItems(rows: number): Item[] {
  const items: Item[] = [];
  for (const x of [72, 330]) {
    for (let row = 0; row < rows; row += 1) {
      items.push({
        str: `line ${row} at ${x}`,
        transform: [10, 0, 0, 10, x, 700 - row * 14],
        width: 200,
        height: 10,
        hasEOL: true,
      });
    }
  }
  return items;
}

/** Fixed pages: empty, blank, short transform, zero font size, two columns. */
const EDGE_PAGES: readonly (readonly Item[])[] = [
  [],
  [{ str: "", transform: [10, 0, 0, 10, 0, 0], width: 0, height: 10 }],
  [{ str: "   ", transform: [10, 0, 0, 10, 72, 700], width: 20, height: 10, hasEOL: true }],
  [{ str: "a", transform: [10, 0, 0, 10, 72], width: 5, height: 10 }],
  [{ str: "x", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0, fontName: "Times-Bold" }],
  twoColumnItems(6),
  twoColumnItems(3),
  twoColumnItems(1),
];

/** Keep predicates: none, drop the top band, drop by string length. */
const KEEPS: readonly (((item: Item) => boolean) | undefined)[] = [
  undefined,
  (item) => item.transform[5]! < 765,
  (item) => item.str.length % 3 !== 0,
];

// --- pageTextFromItems ---

test("pageTextFromItems: Rust and TS agree on seeded items and fixed edges", () => {
  for (const seed of SEEDS) {
    const items = pageItemsFor(random(seed));
    assert.equal(rs.pageTextFromItems(items), ts.pageTextFromItems(items), `seed ${seed}`);
  }
  const fixed: { str: string; hasEOL?: boolean }[][] = [
    [],
    [{ str: "a", hasEOL: false }],
    [{ str: "", hasEOL: true }],
    [{ str: "x" }, { str: "y", hasEOL: true }, { str: "" }],
    [{ str: "😀\t" }, { str: "ΟΔΟΣ", hasEOL: true }],
  ];
  for (const items of fixed) {
    assert.equal(rs.pageTextFromItems(items), ts.pageTextFromItems(items), JSON.stringify(items));
  }
});

// --- isBoldFont ---

const FONT_NAMES: readonly (string | undefined)[] = [
  "Times-Bold",
  "ABCDEF+Arial-BoldMT",
  "Arial-Black",
  "Georgia-Heavy",
  "Helvetica",
  "g_d0_f1",
  "",
  undefined,
  "BOLDITALIC",
  "Blackletter",
  "Heavyweight",
  "SemiBold",
  "Bld",
];

test("isBoldFont: Rust and TS agree on seeded font names, case and absent names", () => {
  for (const name of FONT_NAMES) {
    assert.equal(rs.isBoldFont(name), tsIsBoldFont(name), `font ${String(name)}`);
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const name = pick(rand, FONT_NAMES);
    const value = name === undefined ? undefined : randomCase(rand, name);
    assert.equal(rs.isBoldFont(value), tsIsBoldFont(value), `seed ${seed} font ${String(value)}`);
  }
});

// --- furnitureKey ---

/** Running heads and folios: case, runs of spaces, digits, roman numerals, Unicode spaces. */
const FURNITURE = [
  "Journal of Things",
  "JOURNAL OF   THINGS",
  "ΟΔΟΣ",
  "İstanbul",
  "Page 12",
  "xii",
  "IV",
  "  ",
  "",
  "3",
  "Vol. 7 No. 2",
  "　Head　",
  "﻿BOM",
  "٣ arabic-indic",
  "tab\there",
  "😀",
];

const FURNITURE_DIGITS = ["1", "12", "2019", "IV", "xii", "7", "", "  "];
const FURNITURE_SEPARATORS = [" ", "  ", "\t", "\n", "", " - "];

test("furnitureKey: Rust and TS agree on seeded running heads and folios", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const head = randomCase(rand, pick(rand, FURNITURE));
    const str = `${head}${pick(rand, FURNITURE_SEPARATORS)}${pick(rand, FURNITURE_DIGITS)}`;
    assert.equal(rs.furnitureKey(str), tsFurnitureKey(str), `seed ${seed} str ${JSON.stringify(str)}`);
    const bare = pick(rand, FURNITURE);
    assert.equal(rs.furnitureKey(bare), tsFurnitureKey(bare), `seed ${seed} bare ${JSON.stringify(bare)}`);
  }
  for (const str of FURNITURE) {
    assert.equal(rs.furnitureKey(str), tsFurnitureKey(str), `fixed ${JSON.stringify(str)}`);
  }
});

// --- reconstructLines ---

test("reconstructLines: Rust and TS agree on seeded pages, keep predicates and fixed edges", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const page = 1 + Math.floor(rand() * 3);
    const items = pageItemsFor(rand);
    const keep = KEEPS[seed % KEEPS.length];
    assert.deepEqual(
      rs.reconstructLines(page, items, keep),
      ts.reconstructLines(page, items, keep),
      `seed ${seed} keep ${seed % KEEPS.length}`,
    );
  }
  for (const [index, items] of EDGE_PAGES.entries()) {
    assert.deepEqual(
      rs.reconstructLines(1, items),
      ts.reconstructLines(1, items),
      `edge page ${index}`,
    );
  }
});

// --- detectColumns ---

test("detectColumns: Rust and TS agree on lines from seeded pages and fixed column layouts", () => {
  for (const seed of SEEDS) {
    const items = pageItemsFor(random(seed));
    // Each side reconstructs its own lines, as the callers do, and detects on them.
    const rsColumns = rs.detectColumns(rs.reconstructLines(1, items));
    const tsColumns = ts.detectColumns(ts.reconstructLines(1, items));
    assert.deepEqual(rsColumns, tsColumns, `seed ${seed}`);
  }
  for (const [index, items] of EDGE_PAGES.entries()) {
    assert.deepEqual(
      rs.detectColumns(rs.reconstructLines(1, items)),
      ts.detectColumns(ts.reconstructLines(1, items)),
      `edge page ${index}`,
    );
  }
});

// --- sortByReadingOrder ---

test("sortByReadingOrder: Rust and TS agree on seeded multi-page tagged lines and empty input", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const pages = [pageItemsFor(rand), pageItemsFor(rand)];
    const rsTagged = pages.flatMap((items, index) => {
      const lines = rs.reconstructLines(index + 1, items);
      const columns = rs.detectColumns(lines);
      return lines.map((line, i) => ({ line, column: columns[i]! }));
    });
    const tsTagged = pages.flatMap((items, index) => {
      const lines = ts.reconstructLines(index + 1, items);
      const columns = ts.detectColumns(lines);
      return lines.map((line, i) => ({ line, column: columns[i]! }));
    });
    // Reversed input on half the seeds, so the sort has to order pages, columns and baselines.
    if (seed % 2 === 0) {
      rsTagged.reverse();
      tsTagged.reverse();
    }
    assert.deepEqual(rs.sortByReadingOrder(rsTagged), ts.sortByReadingOrder(tsTagged), `seed ${seed}`);
  }
  assert.deepEqual(rs.sortByReadingOrder([]), ts.sortByReadingOrder([]), "empty input");
});
