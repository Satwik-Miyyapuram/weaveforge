import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust selection anchor and item rect functions return exactly what the TS originals in
// packages/core/src/reader/selection-to-anchor.ts return. Seeded, so a failure reproduces from the seed.

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

type Page = Parameters<typeof ts.selectionToAnchor>[1];
type Item = Page["items"][number];
type Selection = Parameters<typeof ts.selectionToAnchor>[0];

/** Code-point-safe pool: ASCII, accented Latin, CJK, plain and ideographic spaces. */
const STR_POOL: readonly string[] = ["a", "b", " ", "\t", "é", "東", "京", "語", ".", "　", "word", "Zed"];
const HASHES: readonly string[] = ["abc", "  abc  ", "", "   ", "\tdeadbeef\n", "東京"];

function randomStr(rand: () => number, max: number): string {
  const length = int(rand, 0, max);
  let out = "";
  for (let i = 0; i < length; i += 1) out += pick(rand, STR_POOL);
  return out;
}

function randomItem(rand: () => number): Item {
  const transform = [1, 0, 0, 1, int(rand, -50, 750), int(rand, -50, 750)];
  if (rand() < 0.3) {
    transform[2] = rand() * 12 - 6;
    transform[3] = rand() * 12 - 6;
  }
  const item: Item = {
    str: randomStr(rand, 10),
    transform,
    width: rand() < 0.1 ? 0 : rand() * 200,
    height: rand() < 0.15 ? 0 : int(rand, 1, 20),
  };
  if (rand() < 0.4) item.hasEOL = rand() < 0.6;
  return item;
}

function randomPage(rand: () => number): Page {
  const items: Item[] = [];
  const count = int(rand, 0, 8);
  for (let i = 0; i < count; i += 1) items.push(randomItem(rand));
  const page: Page = { pageIndex: int(rand, 0, 3), pageWidth: 612, pageHeight: 792, items };
  if (rand() < 0.5) page.contentHash = pick(rand, HASHES);
  return page;
}

/** Indices run from before the first item to past the last, so out-of-range is common. */
function randomSelection(rand: () => number, items: readonly Item[]): Selection {
  const count = items.length;
  const startItemIndex = int(rand, -1, count + 1);
  const endItemIndex =
    rand() < 0.7 ? int(rand, startItemIndex - 1, startItemIndex + 2) : int(rand, -1, count + 1);
  return {
    startItemIndex,
    startOffset: int(rand, -2, 12),
    endItemIndex,
    endOffset: int(rand, -2, 12),
  };
}

// --- selectionToAnchor ---

test("selectionToAnchor: Rust and TS agree on seeded pages and selections", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const page = randomPage(rand);
    for (let k = 0; k < 4; k += 1) {
      const selection = randomSelection(rand, page.items);
      assert.deepEqual(
        rs.selectionToAnchor(selection, page),
        ts.selectionToAnchor(selection, page),
        `seed ${seed} selection ${k} ${JSON.stringify(selection)}`,
      );
    }
  }
});

const FIXED_PAGE: Page = {
  pageIndex: 3,
  pageWidth: 612,
  pageHeight: 792,
  contentHash: " fixed-hash ",
  items: [
    { str: "Hello", transform: [1, 0, 0, 1, 72, 700], width: 40, height: 12, hasEOL: true },
    { str: "", transform: [1, 0, 0, 1, 72, 686], width: 0, height: 12 },
    { str: "world 東京", transform: [1, 0, 0, 1, 72, 672], width: 80, height: 12 },
    { str: "  ", transform: [1, 0, 0, 1, 72, 658], width: 10, height: 0, hasEOL: true },
    { str: "end.", transform: [1, 0, 0, 1, 72, 644], width: 24, height: 12, hasEOL: false },
  ],
};

test("selectionToAnchor: Rust and TS agree on every index and offset combination of a fixed page", () => {
  const indices = [-2, -1, 0, 1, 2, 3, 4, 5, 6];
  const offsets = [-1, 0, 1, 3, 5, 50];
  for (const startItemIndex of indices) {
    for (const endItemIndex of indices) {
      for (const startOffset of offsets) {
        for (const endOffset of offsets) {
          const selection = { startItemIndex, startOffset, endItemIndex, endOffset };
          assert.deepEqual(
            rs.selectionToAnchor(selection, FIXED_PAGE),
            ts.selectionToAnchor(selection, FIXED_PAGE),
            `selection ${JSON.stringify(selection)}`,
          );
        }
      }
    }
  }
});

test("selectionToAnchor: Rust and TS agree on empty, blank and non-integer selections", () => {
  const blankItem = (str: string): Item => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 5, height: 5 });
  const pages: Page[] = [
    { pageIndex: 0, pageWidth: 1, pageHeight: 1, items: [] },
    { pageIndex: 0, pageWidth: 1, pageHeight: 1, items: [blankItem("")] },
    { pageIndex: 1, pageWidth: 1, pageHeight: 1, items: [blankItem(" \t "), blankItem("　")], contentHash: "   " },
    { pageIndex: 2, pageWidth: 1, pageHeight: 1, items: [blankItem("ab")], contentHash: "" },
  ];
  const selections: Selection[] = [
    { startItemIndex: 0, startOffset: 0, endItemIndex: 0, endOffset: 0 },
    { startItemIndex: 0, startOffset: 0, endItemIndex: 0, endOffset: 1 },
    { startItemIndex: 0, startOffset: 0, endItemIndex: 1, endOffset: 0 },
    { startItemIndex: 0, startOffset: 1, endItemIndex: 0, endOffset: 0 },
    { startItemIndex: 1, startOffset: 0, endItemIndex: 0, endOffset: 0 },
    { startItemIndex: 0.5, startOffset: 0, endItemIndex: 1, endOffset: 1 },
    { startItemIndex: Number.NaN, startOffset: 0, endItemIndex: 0, endOffset: 1 },
    { startItemIndex: 0, startOffset: 0, endItemIndex: Number.POSITIVE_INFINITY, endOffset: 0 },
    { startItemIndex: 0, startOffset: 0, endItemIndex: 0, endOffset: Number.NaN },
    { startItemIndex: 0, startOffset: -5, endItemIndex: 0, endOffset: 99 },
  ];
  for (const page of pages) {
    for (const selection of selections) {
      assert.deepEqual(
        rs.selectionToAnchor(selection, page),
        ts.selectionToAnchor(selection, page),
        `page ${page.items.length} selection ${JSON.stringify(selection)}`,
      );
    }
  }
});

test("selectionToAnchor: Rust and TS agree on 32-char context windows and hasEOL joins", () => {
  const items: Item[] = Array.from({ length: 12 }, (_, i) => ({
    str: `line ${i} 東京語`,
    transform: [1, 0, 0, 1, 72, 700 - i * 14],
    width: 90,
    height: 12,
    hasEOL: i % 3 !== 2,
  }));
  const page: Page = { pageIndex: 2, pageWidth: 612, pageHeight: 792, items, contentHash: " long " };
  const selections: Selection[] = [
    { startItemIndex: 0, startOffset: 0, endItemIndex: 11, endOffset: items[11]!.str.length },
  ];
  for (let i = 0; i < 12; i += 3) {
    selections.push({
      startItemIndex: i,
      startOffset: 2,
      endItemIndex: Math.min(11, i + 4),
      endOffset: 4,
    });
  }
  for (const selection of selections) {
    assert.deepEqual(
      rs.selectionToAnchor(selection, page),
      ts.selectionToAnchor(selection, page),
      `long selection ${JSON.stringify(selection)}`,
    );
  }
});

test("selectionToAnchor: Rust and TS agree on seeded pages with reversed selections", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const page = randomPage(rand);
    const count = page.items.length;
    const a = int(rand, -1, count);
    const b = int(rand, -1, count);
    const selection: Selection = {
      startItemIndex: Math.max(a, b),
      startOffset: int(rand, -2, 12),
      endItemIndex: Math.min(a, b),
      endOffset: int(rand, -2, 12),
    };
    assert.deepEqual(
      rs.selectionToAnchor(selection, page),
      ts.selectionToAnchor(selection, page),
      `seed ${seed} reversed ${JSON.stringify(selection)}`,
    );
  }
});

// --- itemToRect ---

test("itemToRect: Rust and TS agree on default bounds and seeded explicit bounds", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const item = randomItem(rand);
    const len = item.str.length;
    const label = `seed ${seed}`;
    assert.deepEqual(rs.itemToRect(item), ts.itemToRect(item), `${label} default`);
    const from = int(rand, -2, len + 2);
    const to = rand() < 0.15 ? Number.POSITIVE_INFINITY : int(rand, -2, len + 2);
    assert.deepEqual(rs.itemToRect(item, from), ts.itemToRect(item, from), `${label} from ${from}`);
    assert.deepEqual(
      rs.itemToRect(item, from, to),
      ts.itemToRect(item, from, to),
      `${label} from ${from} to ${to}`,
    );
  }
});

const BOUNDS: readonly [number | undefined, number | undefined][] = [
  [undefined, undefined],
  [0, undefined],
  [0, 0],
  [0, 5],
  [2, 2],
  [5, 2],
  [-3, 4],
  [4, 99],
  [99, 120],
  [1.5, 3.9],
  [0, Number.POSITIVE_INFINITY],
];

test("itemToRect: Rust and TS agree on fixed bounds, reversed, out-of-range and zero-width slices", () => {
  const items: Item[] = [
    { str: "Hello 東京", transform: [1, 0, 0, 1, 72, 700], width: 90, height: 12 },
    { str: "", transform: [1, 0, 0, 1, 72, 700], width: 0, height: 12 },
    { str: "x", transform: [1, 0, 0, 1, 72, 700], width: 0, height: 0 },
  ];
  for (const item of items) {
    for (const [from, to] of BOUNDS) {
      assert.deepEqual(
        rs.itemToRect(item, from, to),
        ts.itemToRect(item, from, to),
        `${JSON.stringify(item.str)} from ${from} to ${to}`,
      );
    }
  }
});

test("itemToRect: Rust and TS agree on non-renderable geometry and short transforms", () => {
  const base = { str: "Hello", transform: [1, 0, 0, 1, 72, 700], width: 40, height: 12 };
  const items: Item[] = [
    { ...base, transform: [1, 0, 0, 1, 72] },
    { ...base, transform: [] },
    { ...base, transform: [1, 0, 0, 1, Number.NaN, 700] },
    { ...base, transform: [1, 0, 0, 1, 72, Number.POSITIVE_INFINITY] },
    { ...base, width: Number.NaN },
    { ...base, width: Number.POSITIVE_INFINITY },
    { ...base, height: 0 },
    { ...base, height: 0, transform: [0, 3, 4, 0, 72, 700] },
    { ...base, str: "" },
    { ...base, str: "", width: 0, height: 0 },
  ];
  for (const item of items) {
    for (const [from, to] of BOUNDS) {
      assert.deepEqual(
        rs.itemToRect(item, from, to),
        ts.itemToRect(item, from, to),
        `item ${JSON.stringify(item)} from ${from} to ${to}`,
      );
    }
  }
});
