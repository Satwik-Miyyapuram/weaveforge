import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust link citation functions match packages/core/src/features/reader/link-citations.ts on seeded inputs.

let rs: RustCore;
before(async () => { rs = await loadTestCore(); });

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
/** Inclusive integer in `lo..hi`. */
const int = (rand: () => number, lo: number, hi: number): number => Math.floor(rand() * (hi - lo + 1)) + lo;
/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

type Page = Parameters<typeof ts.coveredTextSpans>[0];
type Item = Page["items"][number];
type Link = Parameters<typeof ts.coveredTextSpans>[1][number];
type Ref = Parameters<typeof ts.referenceForDestination>[1][number];
type Dest = NonNullable<Link["dest"]>;

/** UTF-16 surrogate pairs, NBSP, BOM, newline and separators, so offsets are checked in code units. */
const TEXT_POOL = ["[", "]", "(", ")", ",", ";", " ", " ", "﻿", "\n", "5", "16", "2", "35", "é", "ǆ", "ß", "東", "😀", "word", ""];
const Y_POOL = [100, 300, 500, 502, 503, 650, 660, 700.5];

function randomItem(rand: () => number): Item {
  let str = "";
  for (let i = int(rand, 0, 4); i > 0; i -= 1) str += pick(rand, TEXT_POOL);
  const item: Item = {
    str,
    transform: [1, 0, 0, 1, int(rand, 40, 300), int(rand, 100, 700)],
    width: rand() < 0.15 ? 0 : rand() * 160,
    height: rand() < 0.1 ? 0 : int(rand, 6, 14),
  };
  if (rand() < 0.4) item.hasEOL = rand() < 0.5;
  return item;
}

function randomPage(rand: () => number): Page {
  return { number: int(rand, 1, 2), items: Array.from({ length: int(rand, 0, 6) }, () => randomItem(rand)) };
}

/** Boxes start near an item, so they graze its edges as often as they cover it. */
function randomRect(rand: () => number, items: readonly Item[]): Link["rect"] {
  const item = items.length && rand() < 0.8 ? pick(rand, items) : null;
  if (!item) {
    const x = int(rand, 0, 500);
    const y = int(rand, 0, 700);
    return [x, y, x + int(rand, 0, 60), y + int(rand, 0, 14)];
  }
  const x1 = item.transform[4]! + (rand() * 1.4 - 0.2) * item.width;
  const y1 = item.transform[5]! - 3 + rand() * 4;
  return [x1, y1, x1 + rand() * item.width * 0.9, y1 + item.height * (0.5 + rand() * 1.5)];
}

function randomDest(rand: () => number, page: number): Dest {
  const dest: Dest = { page: rand() < 0.8 ? page : int(rand, 1, 3) };
  if (rand() < 0.7) dest.x = pick(rand, [72, 100, 111, 113, 300, 340, 380, 420]);
  if (rand() < 0.7) dest.y = pick(rand, Y_POOL);
  return dest;
}

/** Measured ranges mix valid spans with non-integers, reversed, empty and out-of-range ones. */
function randomRanges(rand: () => number): { start: number; end: number }[] {
  return Array.from({ length: int(rand, 0, 3) }, () => {
    const start = pick(rand, [0, 1, 2, 8, 1.5, -1, 4, 30]);
    return { start, end: start + pick(rand, [-1, 0, 1, 2, 3, 0.5, 9999]) };
  });
}

function randomLink(rand: () => number, page: Page): Link {
  const link: Link = { rect: randomRect(rand, page.items) };
  if (rand() < 0.8) link.dest = randomDest(rand, page.number);
  if (rand() < 0.1) link.url = "https://example.org";
  if (rand() < 0.3) link.textRanges = randomRanges(rand);
  return link;
}

const links = (rand: () => number, page: Page): Link[] => Array.from({ length: int(rand, 0, 5) }, () => randomLink(rand, page));

const ref = (index: number, page: number, x: number, y: number): Ref => ({ index, raw: `[${index}]`, page, x, y, authors: [] });

function randomRefs(rand: () => number): Ref[] {
  return Array.from({ length: int(rand, 0, 6) }, (_, i) =>
    ref(i + 1, int(rand, 1, 2), pick(rand, [72, 80, 110, 300, 340, 400]), pick(rand, Y_POOL)),
  );
}

test("referenceForDestination: Rust and TS agree on seeded destinations and reference lists", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const refs = randomRefs(rand);
    for (let k = 0; k < 6; k += 1) {
      const dest = randomDest(rand, int(rand, 1, 2));
      assert.deepEqual(plain(rs.referenceForDestination(dest, refs) ?? null), plain(ts.referenceForDestination(dest, refs)), `seed ${seed} dest ${k} ${JSON.stringify(dest)}`);
    }
  }
});

test("referenceForDestination: two columns, the 40pt band and missing x or y", () => {
  const refs: Ref[] = [ref(1, 1, 72, 500), ref(2, 1, 330, 500), ref(3, 1, 72, 300), ref(4, 1, 72, 502.5), ref(5, 2, 72, 500)];
  const dests: Dest[] = [
    { page: 1, x: 72, y: 500 }, { page: 1, x: 110, y: 500 }, { page: 1, x: 113, y: 500 }, { page: 1, x: 330, y: 500 },
    { page: 1, y: 500 }, { page: 1, x: 72 }, { page: 1 }, { page: 1, x: 72, y: 499 }, { page: 1, x: 72, y: 502 },
    { page: 1, x: 72, y: 502.5 }, { page: 1, x: 72, y: 502.6 }, { page: 2, x: 72, y: 100 }, { page: 3, x: 72, y: 500 },
  ];
  for (const dest of dests) {
    assert.deepEqual(plain(rs.referenceForDestination(dest, refs) ?? null), plain(ts.referenceForDestination(dest, refs)), JSON.stringify(dest));
  }
});

test("coveredTextSpans: Rust and TS agree on seeded pages and link boxes", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const page = randomPage(rand);
    const linkList = links(rand, page);
    assert.deepEqual(plain(rs.coveredTextSpans(page as never, linkList)), plain(ts.coveredTextSpans(page, linkList)), `seed ${seed}`);
  }
});

test("coveredTextSpans: bracket citations split per link, Unicode offsets are UTF-16", () => {
  const bracket: Page = { number: 1, items: [{ str: "see [5, 2, 35] here", transform: [1, 0, 0, 1, 72, 600], width: 200, height: 10 }] };
  const boxAt = (x1: number, x2: number): Link => ({ rect: [x1, 597, x2, 613] });
  const emoji: Page = { number: 1, items: [{ str: "a😀b", transform: [1, 0, 0, 1, 72, 600], width: 30, height: 10 }] };
  const cases: [Page, Link[], string[]][] = [
    [bracket, [boxAt(122, 132), boxAt(152, 162), boxAt(182, 204)], ["5", "2", "35"]],
    [emoji, [boxAt(79.5, 94.5)], ["😀"]],
  ];
  for (const [page, linkList, expected] of cases) {
    const rsOut = rs.coveredTextSpans(page as never, linkList);
    const tsOut = ts.coveredTextSpans(page, linkList);
    assert.deepEqual(plain(rsOut), plain(tsOut));
    assert.deepEqual(tsOut.spans.map((s) => tsOut.text.slice(s.start, s.end)), expected);
  }
});

test("coveredTextSpans: textRanges, zero-width items and grazing boxes agree", () => {
  const page: Page = {
    number: 1,
    items: [
      { str: "[16]", transform: [1, 0, 0, 1, 72, 600], width: 20, height: 10, hasEOL: true },
      { str: "", transform: [1, 0, 0, 1, 90, 600], width: 0, height: 0 },
      { str: "ǆ ß", transform: [1, 0, 0, 1, 110, 600], width: 30, height: 10 },
    ],
  };
  const linkList: Link[] = [
    { rect: [72, 597, 92, 613], textRanges: [{ start: 1, end: 3 }] },
    { rect: [72, 597, 92, 613], textRanges: [{ start: 1.5, end: 3 }, { start: 3, end: 1 }, { start: 0, end: 9999 }] },
    { rect: [90, 597, 90, 613] },
    { rect: [109, 597, 112, 613], dest: { page: 1 } },
    { rect: [72, 597, 140, 613], url: "https://example.org", dest: { page: 1 } },
  ];
  assert.deepEqual(plain(rs.coveredTextSpans(page as never, linkList)), plain(ts.coveredTextSpans(page, linkList)));
  for (let seed = 1; seed <= 50; seed += 1) {
    const rand = random(seed);
    const grazing: Link[] = [{ rect: [72 + rand() * 20, 596, 80 + rand() * 20, 614] }];
    assert.deepEqual(plain(rs.coveredTextSpans(page as never, grazing)), plain(ts.coveredTextSpans(page, grazing)), `seed ${seed}`);
  }
});

// Rust strings are always well-formed: a lone surrogate TS keeps arrives as U+FFFD.
function wellFormed(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
    typeof v === "string" ? v.replace(/\p{Cs}/gu, "\ufffd") : v,
  );
}

test("linkCitationMentions: Rust and TS agree on seeded pages, refs and links", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const page = randomPage(rand);
    const refs = randomRefs(rand);
    const linkList = links(rand, page);
    assert.deepEqual(plain(rs.linkCitationMentions(page as never, linkList, refs)), wellFormed(plain(ts.linkCitationMentions(page, linkList, refs))), `seed ${seed}`);
  }
});

test("linkCitationMentions: url links and empty boxes give nothing on both sides", () => {
  const page: Page = { number: 1, items: [{ str: "see [5] here", transform: [1, 0, 0, 1, 72, 600], width: 80, height: 10 }] };
  const refs: Ref[] = [ref(5, 1, 72, 600)];
  const linkList: Link[] = [{ rect: [72, 597, 150, 613], dest: { page: 1 }, url: "https://example.org" }, { rect: [90, 597, 90, 613], dest: { page: 1 } }];
  assert.deepEqual(plain(rs.linkCitationMentions(page as never, linkList, refs)), plain(ts.linkCitationMentions(page, linkList, refs)));
  assert.deepEqual(ts.linkCitationMentions(page, linkList, refs), []);
});
