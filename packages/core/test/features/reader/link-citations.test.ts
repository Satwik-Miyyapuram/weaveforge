import { test } from "node:test";
import assert from "node:assert/strict";
import { type ParsedReference, type PdfLink } from "../../../src/features/reader/index.js";
import type { PageTextItem } from "../../../src/features/reader/page-text-item.js";
import * as wasm from "../../../../wf-wasm/src/index.ts";
import type { CoreContract } from "../../../src/index.js";

// Their TypeScript was removed; the Rust core is the implementation.
const { linkCitationMentions, referenceForDestination } = wasm as unknown as CoreContract;

/** Entry `index` on page 3 at x 40, one 15-point line per entry below a heading at y 700. */
function entry(index: number): ParsedReference {
  return { index, raw: `[${index}]`, page: 3, x: 40, y: 700 - index * 15, authors: [] };
}
const refs = [1, 2, 3].map(entry);
const text = (items: PageTextItem[]) => items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("");

test("a destination resolves to the entry at or just below it, in its column", () => {
  assert.equal(referenceForDestination({ page: 3, x: 40, y: 688 }, refs)?.index, 1);
  assert.equal(referenceForDestination({ page: 3, x: 40, y: 672 }, refs)?.index, 2);
  assert.equal(referenceForDestination({ page: 3, x: 40, y: 657 }, refs)?.index, 3);
  assert.equal(referenceForDestination({ page: 4 }, refs), null);
});

test("link boxes map to the characters under them under the page-text convention", () => {
  const item = (str: string, x: number, w: number, hasEOL = false): PageTextItem => ({
    str,
    transform: [10, 0, 0, 10, x, 500],
    width: w,
    height: 10,
    hasEOL,
  });
  const items = [item("memory [", 100, 40, true), item("2", 140, 5), item(" ", 145, 0), item("] and", 145, 25)];
  const links: PdfLink[] = [
    { rect: [139, 498, 146, 510], dest: { page: 3, x: 40, y: 672 } },
    { rect: [300, 498, 310, 510], url: "https://example.org" },
  ];
  const hits = linkCitationMentions({ number: 1, items }, links, refs);
  assert.equal(hits.length, 1);
  assert.equal(text(items).slice(hits[0]!.start, hits[0]!.end), "2");
  assert.deepEqual(hits[0]!.referenceIndexes, [2]);
});

test("three links over one `[38, 2, 9]` item give three separate citations", () => {
  const item: PageTextItem = { str: "[38, 2, 9].", transform: [10, 0, 0, 10, 143.87, 420.55], width: 39.01, height: 10, hasEOL: true };
  const list = Array.from({ length: 40 }, (_, i) => entry(i + 1));
  const at = (i: number) => list[i - 1]!.y + 1;
  const links: PdfLink[] = [
    { rect: [146.19, 419.45, 158.14, 428.3], dest: { page: 3, x: 40, y: at(38) } },
    { rect: [161.13, 419.55, 168.1, 428.3], dest: { page: 3, x: 40, y: at(2) } },
    { rect: [171.09, 419.33, 178.07, 428.3], dest: { page: 3, x: 40, y: at(9) } },
  ];
  const hits = linkCitationMentions({ number: 1, items: [item] }, links, list);
  assert.deepEqual(
    hits.map((h) => [item.str.slice(h.start, h.end), h.referenceIndexes]),
    [
      ["38", [38]],
      ["2", [2]],
      ["9", [9]],
    ],
  );
});

test("a link measured against the rendered layout keeps its measured characters over the width estimate", () => {
  // One wide run whose reported width is far off: the proportional estimate
  // would land the box on the wrong digits, the measured range says `2`.
  const items: PageTextItem[] = [
    { str: "as shown in [1, 2, 3] here", transform: [10, 0, 0, 10, 50, 700], width: 60, height: 10, hasEOL: true },
  ];
  const links: PdfLink[] = [
    { rect: [50, 698, 52, 710], dest: { page: 3, x: 40, y: 672 }, textRanges: [{ start: 16, end: 17 }] },
  ];
  const hits = linkCitationMentions({ number: 1, items }, links, refs);
  assert.deepEqual(hits.map((h) => [text(items).slice(h.start, h.end), h.referenceIndexes]), [["2", [2]]]);
});
