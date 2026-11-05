import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust whole-document analysis returns exactly what the TS original in
// packages/core/src/features/reader/analysis/document-analysis.ts returns. Pages are seeded
// paper-like layouts (headings, citations, figure mentions, a reference list, links), so a
// failure reproduces from the seed.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

type Page = Parameters<typeof ts.analyzePdfDocument>[0][number];
type Item = Page["items"][number];
type Link = NonNullable<Page["links"]>[number];
type Outline = NonNullable<Parameters<typeof ts.analyzePdfDocument>[1]>;

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

/** Drops `undefined` keys, which serde leaves out, so only real differences fail. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const WORDS = ["model", "data", "the", "learning", "we", "show", "results", "on", "a", "network", "training", "loss"];
const CITES = ["[1]", "[2, 3]", "[4-6]", "(Smith et al., 2020)", "(Lee and Park, 2019a)", "Jones [7]"];
const FIGURES = ["Figure 2", "Fig. 3a", "Table 1", "Figs. 1 and 2", "Algorithm 1"];
const HEADINGS = ["1 Introduction", "2 Related Work", "3 Method", "4 Experiments", "5 Conclusion"];

function item(str: string, x: number, y: number, size: number, eol: boolean, font?: string): Item {
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    hasEOL: eol,
    ...(font ? { fontName: font } : {}),
  } as Item;
}

function sentence(rand: () => number): string {
  const words = Array.from({ length: 4 + Math.floor(rand() * 8) }, () => pick(rand, WORDS));
  if (rand() < 0.4) words.splice(Math.floor(rand() * words.length), 0, pick(rand, CITES));
  if (rand() < 0.2) words.splice(Math.floor(rand() * words.length), 0, pick(rand, FIGURES));
  return words.join(" ");
}

function bodyPage(rand: () => number, pageNumber: number, headingIndex: number): Page {
  const items: Item[] = [];
  const twoColumn = rand() < 0.3;
  const columns = twoColumn ? [72, 320] : [72];
  if (rand() < 0.5) items.push(item(`Running head ${pageNumber % 2 ? "odd" : "even"}`, 200, 760, 8, true));
  for (const x of columns) {
    let y = 720;
    if (rand() < 0.6) {
      items.push(item(HEADINGS[headingIndex % HEADINGS.length]!, x, y, 12, true, "Times-Bold"));
      y -= 20;
    }
    const lines = 5 + Math.floor(rand() * 15);
    for (let i = 0; i < lines; i += 1) {
      items.push(item(sentence(rand), x, y, 10, true));
      y -= 12;
    }
  }
  if (rand() < 0.1) items.push({ ...item("rotated note", 20, 400, 8, true), transform: [0, 8, -8, 0, 20, 400] } as Item);
  if (rand() < 0.3) items.push(item(String(pageNumber), 300, 40, 9, false));
  const links: Link[] = [];
  if (rand() < 0.4) links.push({ rect: [72, 700, 90, 712], dest: { page: 9, y: 600 }, destName: "cite.smith2020" });
  if (rand() < 0.2) links.push({ rect: [100, 680, 160, 692], url: "https://example.org" });
  return { pageNumber, items, ...(links.length ? { links } : {}) };
}

function referencePage(rand: () => number, pageNumber: number): Page {
  const items: Item[] = [item("References", 72, 720, 12, true, "Times-Bold")];
  let y = 700;
  const count = 3 + Math.floor(rand() * 8);
  for (let i = 1; i <= count; i += 1) {
    const author = pick(rand, ["A. Smith", "B. Lee and C. Park", "D. Jones, E. Wu, and F. Kim"]);
    const year = 2000 + Math.floor(rand() * 24);
    const label = rand() < 0.7 ? `[${i}] ` : "";
    items.push(item(`${label}${author}. A study of ${pick(rand, WORDS)} ${pick(rand, WORDS)}.`, 72, y, 9, true));
    y -= 11;
    items.push(item(`In Proceedings of the Conference, ${year}.`, 84, y, 9, true));
    y -= 13;
  }
  return { pageNumber, items };
}

function document(seed: number): { pages: Page[]; outline: Outline } {
  const rand = random(seed);
  const count = Math.floor(rand() * 6);
  const pages: Page[] = [];
  for (let i = 1; i <= count; i += 1) pages.push(bodyPage(rand, i, i - 1));
  if (count > 0 && rand() < 0.7) pages.push(referencePage(rand, count + 1));
  const outline: Outline =
    rand() < 0.25 ? [{ title: "Introduction", pageNumber: 1 }, { title: "Method", pageNumber: 2, y: 500 }] : [];
  return { pages, outline };
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

test("analyzePdfDocument matches TS on seeded paper layouts", () => {
  for (const seed of SEEDS) {
    const { pages, outline } = document(seed);
    assert.deepStrictEqual(
      plain(rs.analyzePdfDocument(pages as never, outline as never)),
      plain(ts.analyzePdfDocument(pages, outline)),
      `seed ${seed}`,
    );
  }
});

test("analyzePdfDocument defaults the outline and handles no pages", () => {
  const { pages } = document(7);
  assert.deepStrictEqual(plain(rs.analyzePdfDocument(pages as never)), plain(ts.analyzePdfDocument(pages)));
  assert.deepStrictEqual(plain(rs.analyzePdfDocument([])), plain(ts.analyzePdfDocument([])));
});
