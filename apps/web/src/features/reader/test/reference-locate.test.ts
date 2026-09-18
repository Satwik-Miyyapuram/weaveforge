import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageTextItem } from "@weaveforge/core";
import { locateMention, pageTextFromItems, unionRect } from "../application/reference-locate";
import { buildPageText } from "../ui/pdf-reader/pdf-document";

/**
 * Three runs as pdf.js reports them: `see [12]`, `and` (end of line), `[13]`.
 * With `buildPageText`'s convention the page text is
 * `"see [12]and\n[13]"` — offsets 0-8, 8-11, a newline at 11, then 12-16.
 */
const items: PageTextItem[] = [
  { str: "see [12]", transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10 },
  { str: "and", transform: [10, 0, 0, 10, 72, 680], width: 18, height: 10, hasEOL: true },
  { str: "[13]", transform: [10, 0, 0, 10, 90, 680], width: 20, height: 10 },
];

test("a mention inside one run is narrowed to its own characters", () => {
  // "[12]" is characters 4-8 of a 8-character run starting at x=72 with w=40.
  const { rects, bounds } = locateMention(items, 4, 8);
  assert.deepEqual(rects, [[92, 700, 112, 710]]);
  assert.deepEqual(bounds, [92, 700, 112, 710]);
});

test("a mention covering a whole run uses the run's full width", () => {
  assert.deepEqual(locateMention(items, 0, 8).rects, [[72, 700, 112, 710]]);
});

test("a mention spanning a line break yields one rect per run", () => {
  // Offsets 9-14: the tail of `and`, the newline, then the first two characters
  // of `[13]`. The newline advances the offset space without a glyph run, so
  // `[13]` is found at 12 and 2 of its 4 characters are covered. An offset walk
  // that ignored the newline would start this run at 11, cover 3 characters and
  // report x1=105 instead of 100.
  const { rects, bounds } = locateMention(items, 9, 14);
  assert.deepEqual(rects, [
    [78, 680, 90, 690],
    [90, 680, 100, 690],
  ]);
  assert.deepEqual(bounds, [78, 680, 100, 690]);
});

test("an empty, reversed or unmeasurable range paints nothing", () => {
  assert.deepEqual(locateMention(items, 8, 8).rects, []);
  assert.deepEqual(locateMention(items, 10, 2).rects, []);
  assert.deepEqual(locateMention(items, Number.NaN, 12).rects, []);
  assert.equal(locateMention(items, 8, 8).bounds, null);
});

test("a range past the end of the page paints nothing rather than a stray rect", () => {
  assert.deepEqual(locateMention(items, 40, 60).rects, []);
});

test("zero-length runs advance no geometry and do not shift the cursor", () => {
  const withBlank: PageTextItem[] = [
    { str: "", transform: [10, 0, 0, 10, 72, 700], width: 0, height: 10 },
    ...items,
  ];
  assert.deepEqual(locateMention(withBlank, 4, 8).rects, [[92, 700, 112, 710]]);
});

test("the offset space agrees with the reader's own page text", () => {
  // The finders report offsets into this string and the overlay walks it back to
  // runs. If the two ever disagree, every mention after a line break lands on the
  // wrong run — so the two implementations are pinned together here.
  const all: PageTextItem[] = [
    ...items,
    { str: "tail", transform: [10, 0, 0, 10, 72, 660], width: 22, height: 10, hasEOL: true },
    { str: "", transform: [10, 0, 0, 10, 72, 640], width: 0, height: 10 },
  ];
  assert.equal(pageTextFromItems(all), buildPageText(all).text);
  assert.equal(pageTextFromItems(all), "see [12]and\n[13]tail\n");
});

test("unionRect is null with nothing to union, and reaches every corner", () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(
    unionRect([
      [10, 20, 30, 40],
      [5, 25, 12, 60],
    ]),
    [5, 20, 30, 60],
  );
});