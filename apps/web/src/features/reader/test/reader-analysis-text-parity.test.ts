import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import * as tsText from "../../../../../../packages/core/src/features/reader/analysis/citation-text";
import * as tsTitle from "../../../../../../packages/core/src/features/reader/title-similarity";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust citation text, title similarity and fingerprint functions return exactly what the TS
// originals in packages/core/src/features/reader/ return. Seeded, so a failure reproduces from the seed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

type PdfItem = Parameters<typeof tsText.fontSizeOf>[0];

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

// --- Shared inputs: whole code points only, so no lone surrogates ---

/** Zero-width characters, soft hyphen, no-break and thin spaces. */
const INVISIBLE = ["​", "‌", "‍", "﻿", "­", "⁠", " ", " ", " "];

/** Spacing accents (TeX-style) and combining marks. */
const ACCENTS = ["´", "`", "¨", "ˆ", "˜", "ˋ", "¯", "́", "̈"];

/** Latin, Greek, Cyrillic, common CJK, ligatures and an astral emoji. */
const LETTERS = ["a", "e", "B", "M", "ü", "é", "ö", "ß", "ø", "Ø", "ñ", "ﬁ", "ﬂ", "Ω", "ω", "Ж", "я", "漢", "字", "😀"];

const SPACES = [" ", "  ", "\t", "\n", " "];

/** Accented and particle surnames, plus a Turkish dotted capital. */
const NAMES = [
  "Müller", "García", "Ørsted", "van der Berg", "O'Neil", "Ødegaard", "de la Cruz", "von Braun",
  "Łukasiński", "Nguyễn", "Αλεξίου", "Иванов", "王", "ﬁnn", "İlhan",
];

const TEXT_PARTS = [
  ...LETTERS, ...INVISIBLE, ...ACCENTS, ...SPACES, ...NAMES,
  "Ball´e", "Ball´ e", "Ball¨u", "´ e", "-", ".",
];

/** Hand-picked texts for accents, invisibles and ligatures at word edges. */
const TEXT_EDGES: readonly string[] = [
  "", "​", "­­", "Ball´e", "Ball´ e", "Ball´´e", "´",
  "Ball´", "´ e", "Ball´\te", "Ball´\ne", "a`e", "a`", "Balĺ", "ﬁ", "ﬂ",
  "ﬁ​x", "Müller­", "Ø¨", "Δ́", "Ж¸", "漢´字", " x y z",
  "van der Berg", "O'Neil", "ˇ˚", "´´", "´  e", "😀´e",
];

function textFor(rand: () => number, max: number): string {
  let text = "";
  const parts = Math.floor(rand() * (max + 1));
  for (let i = 0; i < parts; i += 1) text += pick(rand, TEXT_PARTS);
  return text;
}

/** Axis-aligned transforms only, so `Math.hypot` is exact on both sides. */
function itemFor(rand: () => number): PdfItem {
  const size = pick(rand, [0, 6, 8, 9.5, 10, 12, 14]);
  const transform = rand() < 0.15 ? [0, size, size, 0] : [size, 0, 0, size];
  transform.push(pick(rand, [0, 10.5, 72, 100.25, 300.75, -4]), pick(rand, [0, 100, 250.5, 600.25, 740]));
  const item: PdfItem = {
    str: textFor(rand, 3),
    transform,
    width: pick(rand, [0, 8.25, 12, 33.5, 60, 120.75, -1]),
    height: pick(rand, [0, 6, 10, 12]),
    hasEOL: rand() < 0.2,
  };
  if (rand() < 0.3) item.fontAscent = pick(rand, [0.7, 0.85, 1]);
  if (rand() < 0.3) item.fontDescent = pick(rand, [-0.1, -0.15, -0.3]);
  return item;
}

function itemsFor(rand: () => number): PdfItem[] {
  const count = Math.floor(rand() * 6);
  return Array.from({ length: count }, () => itemFor(rand));
}

const ITEM_EDGES: readonly PdfItem[] = [
  { str: "", transform: [0, 0, 0, 0, 0, 0], width: 0, height: 0 },
  { str: "Ball´e", transform: [10, 0, 0, 10, 0, 0], width: 30, height: 10, hasEOL: true },
  { str: "ﬁnal", transform: [12, 0, 0, 12, 50, 100], width: 0, height: 12 },
  { str: "x", transform: [0, 8, 8, 0, 5, 5], width: -1, height: 8 },
  { str: "abc", transform: [9, 0, 0, 9, 10, 10], width: 20, height: 0, fontAscent: 1, fontDescent: -0.3 },
];

// --- Text normalisation: stripInvisible, composeSpacingAccents, searchTextFromItems, originalRange ---

test("stripInvisible: Rust and TS agree on fixed edges and seeded invisible text", () => {
  for (const text of TEXT_EDGES) {
    assert.equal(rs.stripInvisible(text), ts.stripInvisible(text), `edge ${JSON.stringify(text)}`);
  }
  for (const seed of SEEDS) {
    const text = textFor(random(seed), 12);
    assert.equal(rs.stripInvisible(text), ts.stripInvisible(text), `seed ${seed} text ${JSON.stringify(text)}`);
  }
});

test("composeSpacingAccents: Rust and TS agree on fixed accent edges and seeded text", () => {
  for (const text of TEXT_EDGES) {
    assert.equal(rs.composeSpacingAccents(text), ts.composeSpacingAccents(text), `edge ${JSON.stringify(text)}`);
  }
  for (const seed of SEEDS) {
    const text = textFor(random(seed), 12);
    assert.equal(
      rs.composeSpacingAccents(text),
      ts.composeSpacingAccents(text),
      `seed ${seed} text ${JSON.stringify(text)}`,
    );
  }
});

test("fontSizeOf: Rust and TS agree on axis-aligned transforms and fallbacks", () => {
  for (const item of ITEM_EDGES) {
    sameNumber(rs.fontSizeOf(item), tsText.fontSizeOf(item), `edge ${JSON.stringify(item)}`);
  }
  for (const seed of SEEDS) {
    const item = itemFor(random(seed));
    sameNumber(rs.fontSizeOf(item), tsText.fontSizeOf(item), `seed ${seed} item ${JSON.stringify(item)}`);
  }
});

test("searchTextFromItems: Rust and TS agree on seeded item runs, gaps and line ends", () => {
  assert.deepEqual(rs.searchTextFromItems([]), ts.searchTextFromItems([]), "no items");
  assert.deepEqual(
    rs.searchTextFromItems(ITEM_EDGES),
    ts.searchTextFromItems(ITEM_EDGES),
    "edge items",
  );
  for (const seed of SEEDS) {
    const items = itemsFor(random(seed));
    assert.deepEqual(
      rs.searchTextFromItems(items),
      ts.searchTextFromItems(items),
      `seed ${seed} items ${JSON.stringify(items)}`,
    );
  }
});

test("originalRange: Rust and TS agree on in-bounds, out-of-bounds and inverted spans", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const view = ts.searchTextFromItems(itemsFor(rand));
    const length = view.text.length;
    const spans: [number, number][] = [[0, 0], [0, length], [-1, 1], [length, length + 3], [2, 1]];
    for (let i = 0; i < 6; i += 1) {
      spans.push([Math.floor(rand() * (length + 5)) - 2, Math.floor(rand() * (length + 5)) - 2]);
    }
    for (const [start, end] of spans) {
      assert.deepEqual(
        rs.originalRange(view, start, end),
        ts.originalRange(view, start, end),
        `seed ${seed} span ${start}..${end} of ${length}`,
      );
    }
  }
});

// --- PDF rects: citationItemToRect (TS itemToRect), mentionRects, rectanglesOverlap ---

test("citationItemToRect: Rust and TS agree on default and explicit ranges", () => {
  for (const item of ITEM_EDGES) {
    assert.deepEqual(rs.citationItemToRect(item), tsText.itemToRect(item), `edge ${JSON.stringify(item)}`);
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const item = itemFor(rand);
    const length = item.str.length;
    assert.deepEqual(rs.citationItemToRect(item), tsText.itemToRect(item), `seed ${seed} default`);
    for (let i = 0; i < 3; i += 1) {
      const from = Math.floor(rand() * (length + 3)) - 1;
      const to = Math.floor(rand() * (length + 3)) - 1;
      assert.deepEqual(
        rs.citationItemToRect(item, from, to),
        tsText.itemToRect(item, from, to),
        `seed ${seed} range ${from}..${to} of ${length} item ${JSON.stringify(item)}`,
      );
    }
  }
});

test("mentionRects: Rust and TS agree on seeded item runs and spans in and out of bounds", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const items = itemsFor(rand);
    const total = items.reduce((n, item) => n + item.str.length + (item.hasEOL ? 1 : 0), 0);
    const spans: [number, number][] = [[0, total], [0, 0], [total, total + 2], [-2, 1]];
    for (let i = 0; i < 4; i += 1) {
      const start = Math.floor(rand() * (total + 3)) - 1;
      spans.push([start, start + Math.floor(rand() * (total + 2)) - 1]);
    }
    for (const [start, end] of spans) {
      assert.deepEqual(
        rs.mentionRects(items, start, end),
        ts.mentionRects(items, start, end),
        `seed ${seed} span ${start}..${end} of ${total}`,
      );
    }
  }
});

/** Grid values keep every sum exact in both implementations. */
const GRID = [-5, -2.5, 0, 1, 2.5, 5, 10];

function rectFor(rand: () => number): number[] {
  const x0 = pick(rand, GRID);
  const y0 = pick(rand, GRID);
  const width = pick(rand, [-2, 0, 0.5, 2, 4, 8]);
  const height = pick(rand, [-2, 0, 0.5, 2, 4, 8]);
  return [x0, y0, x0 + width, y0 + height];
}

test("rectanglesOverlap: Rust and TS agree on touching, disjoint, degenerate and inverted rects", () => {
  const fixed: [number[], number[]][] = [
    [[0, 0, 10, 10], [10, 0, 20, 10]],
    [[0, 0, 10, 10], [0, 10, 10, 20]],
    [[0, 0, 10, 10], [5, 5, 15, 15]],
    [[0, 0, 10, 10], [2, 2, 8, 8]],
    [[0, 0, 10, 10], [0, 0, 10, 10]],
    [[5, 5, 5, 5], [0, 0, 10, 10]],
    [[5, 5, 5, 5], [5, 5, 5, 5]],
    [[10, 10, 0, 0], [0, 0, 10, 10]],
    [[0, 0, 10, 10], [20, 20, 30, 30]],
    [[-5, -5, -2.5, -2.5], [-3, -3, 0, 0]],
  ];
  for (const [a, b] of fixed) {
    assert.equal(rs.rectanglesOverlap(a, b), tsText.rectanglesOverlap(a, b), `fixed ${JSON.stringify([a, b])}`);
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const a = rectFor(rand);
    const b = rectFor(rand);
    assert.equal(rs.rectanglesOverlap(a, b), tsText.rectanglesOverlap(a, b), `seed ${seed} ${JSON.stringify([a, b])}`);
  }
});

// --- Names: surnameKey ---

/** A name with case, padding, runs of spaces inside particles, and trailing punctuation. */
function nameVariant(rand: () => number): string {
  const base = pick(rand, NAMES);
  const spaced = rand() < 0.2 ? base.replace(/ /g, "  ") : base;
  const cased = rand() < 0.5 ? randomCase(rand, spaced) : spaced;
  return pick(rand, ["", " ", "\t"]) + cased + pick(rand, ["", ".", "-", " Jr."]);
}

test("surnameKey: Rust and TS agree on accented names, particles, blanks and case", () => {
  for (const name of [...NAMES, "", " ", "van ", "van der", "Van Der Berg", "VON  BRAUN", "d'Artagnan"]) {
    assert.equal(rs.surnameKey(name), ts.surnameKey(name), `fixed ${JSON.stringify(name)}`);
  }
  for (const seed of SEEDS) {
    const name = nameVariant(random(seed));
    assert.equal(rs.surnameKey(name), ts.surnameKey(name), `seed ${seed} name ${JSON.stringify(name)}`);
  }
});

// --- Fingerprint: textFingerprint ---

test("textFingerprint: Rust and TS agree on empty lists, UTF-16 units and seeded layers", () => {
  assert.equal(rs.textFingerprint([]), ts.textFingerprint([]), "no texts");
  for (const text of TEXT_EDGES) {
    assert.equal(rs.textFingerprint([text]), ts.textFingerprint([text]), `edge ${JSON.stringify(text)}`);
  }
  assert.equal(rs.textFingerprint(["", ""]), ts.textFingerprint(["", ""]), "two blanks");
  assert.equal(rs.textFingerprint(["a", "b"]), ts.textFingerprint(["a", "b"]), "order a b");
  assert.equal(rs.textFingerprint(["b", "a"]), ts.textFingerprint(["b", "a"]), "order b a");
  for (const seed of SEEDS) {
    const rand = random(seed);
    const texts = Array.from({ length: Math.floor(rand() * 4) }, () => textFor(rand, 6));
    assert.equal(
      rs.textFingerprint(texts),
      ts.textFingerprint(texts),
      `seed ${seed} texts ${JSON.stringify(texts)}`,
    );
  }
});

// --- Titles: titleSimilarity, isBibliographicMatch ---

const TITLES: readonly string[] = [
  "Attention Is All You Need",
  "Deep Residual Learning for Image Recognition",
  "Über die Entwicklung der Müller-Lyer-Täuschung",
  "García Márquez: Cien años de soledad",
  "Ørsted's law of electromagnetism",
  "Ballé and Laparra: Perceptual Image Compression",
  "Αλγόριθμος ταξινόμησης",
  "Метод конечных элементов",
  "深度学习 综述",
  "ﬁnding ﬂows in graphs",
  "O'Neil & Sons: 2019 review (part 2)",
  "",
];

/** Small edits to a title: case, punctuation, a dropped or swapped word, decomposition, an appended tag. */
function titleVariant(rand: () => number, title: string): string {
  const words = title.split(" ");
  switch (Math.floor(rand() * 7)) {
    case 0:
      return title;
    case 1:
      return randomCase(rand, title);
    case 2:
      return title.replace(/[:,&'’()-]/g, " ");
    case 3: {
      const drop = Math.floor(rand() * words.length);
      return words.filter((_, i) => i !== drop).join(" ");
    }
    case 4:
      return [...words].reverse().join(" ");
    case 5:
      return title.normalize("NFD");
    default:
      return `${title} ${pick(rand, ["Extended", "II", "2019"])}`;
  }
}

const TITLE_PAIRS: readonly [string, string][] = [
  ["", ""],
  ["", "Attention"],
  ["!!!", "a"],
  ["a", "a"],
  ["Attention Is All You Need", "attention is all you need"],
  ["Attention Is All You Need", "Attention Is All You Need!"],
  ["Ballé", "Balle"],
  ["Müller", "Muller"],
  ["ﬁnd", "find"],
  ["Αλγόριθμος", "αλγόριθμος"],
  ["深度学习", "深度 学习"],
  ["A B C D E F", "A B C D E F G"],
];

test("titleSimilarity: Rust and TS agree on fixed pairs, small edits and word order", () => {
  for (const [left, right] of TITLE_PAIRS) {
    sameNumber(rs.titleSimilarity(left, right), tsTitle.titleSimilarity(left, right), `fixed ${JSON.stringify([left, right])}`);
    sameNumber(rs.titleSimilarity(right, left), tsTitle.titleSimilarity(right, left), `flipped ${JSON.stringify([left, right])}`);
  }
  for (const seed of SEEDS) {
    const rand = random(seed);
    const left = pick(rand, TITLES);
    const right = rand() < 0.2 ? pick(rand, TITLES) : titleVariant(rand, left);
    sameNumber(
      rs.titleSimilarity(left, right),
      tsTitle.titleSimilarity(left, right),
      `seed ${seed} ${JSON.stringify([left, right])}`,
    );
  }
});

const YEARS: readonly (number | null)[] = [null, 2017, 2018, 2019, 2020, 2021, 2022];

test("isBibliographicMatch: Rust and TS agree on title threshold, year window and doi presence", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const base = pick(rand, TITLES);
    const extras = {
      authors: rand() < 0.5 ? ["Müller, K."] : [],
      doi: rand() < 0.5 ? "10.1000/xyz" : undefined,
    };
    const hintTitle = rand() < 0.1 ? pick(rand, [null, ""]) : titleVariant(rand, base);
    const hintYear = pick(rand, YEARS);
    const candidateTitle = titleVariant(rand, base);
    const candidateYear = pick(rand, YEARS);

    const rsHints = { title: hintTitle, year: hintYear, ...extras };
    const rsCandidate = { title: candidateTitle, year: candidateYear, ...extras };
    const tsHints = { title: hintTitle ?? undefined, year: hintYear ?? undefined, ...extras };
    const tsCandidate = { title: candidateTitle, year: candidateYear ?? undefined, ...extras };

    assert.equal(
      rs.isBibliographicMatch(rsHints, rsCandidate),
      ts.isBibliographicMatch(tsHints, tsCandidate),
      `seed ${seed} hints ${JSON.stringify(rsHints)} candidate ${JSON.stringify(rsCandidate)}`,
    );
  }
});

test("isBibliographicMatch: Rust and TS agree on fixed year boundaries and empty titles", () => {
  const title = "Attention Is All You Need";
  for (const hintTitle of [null, "", title, "Attention Is All"]) {
    for (const hintYear of YEARS) {
      for (const candidateYear of YEARS) {
        const rsHints = { title: hintTitle, year: hintYear };
        const rsCandidate = { title, year: candidateYear };
        const tsHints = { title: hintTitle ?? undefined, year: hintYear ?? undefined };
        const tsCandidate = { title, year: candidateYear ?? undefined };
        assert.equal(
          rs.isBibliographicMatch(rsHints, rsCandidate),
          ts.isBibliographicMatch(tsHints, tsCandidate),
          `hints ${JSON.stringify(rsHints)} candidate ${JSON.stringify(rsCandidate)}`,
        );
      }
    }
  }
});
