import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeSpacingAccents,
  matchAuthorYearText,
  originalRange,
  searchTextFromItems,
  type ParsedReference,
} from "../../../src/features/reader/index.js";
import type { PageTextItem } from "../../../src/reader/index.js";

function item(str: string, x: number, width: number, hasEOL = false): PageTextItem {
  return { str, dir: "ltr", width, height: 10, transform: [10, 0, 0, 10, x, 700], fontName: "f", hasEOL } as PageTextItem;
}

test("composeSpacingAccents puts a TeX spacing accent back on its letter", () => {
  assert.equal(composeSpacingAccents("Ball´e"), "Ballé");
  assert.equal(composeSpacingAccents("Ball´ e"), "Ballé");
  assert.equal(composeSpacingAccents("F¨oldi´ak"), "Földiák");
  // An accent before anything but a letter is left alone.
  assert.equal(composeSpacingAccents("a ´ 1"), "a ´ 1");
});

test("searchTextFromItems composes an accent drawn as its own item", () => {
  const items = [item("Ball", 0, 20), item("´", 18, 3), item("e et al., 2017", 20, 60)];
  const view = searchTextFromItems(items);
  assert.equal(view.text, "Ballé et al., 2017");
  // "é" maps back over both the accent glyph and the letter in the raw text.
  const at = view.text.indexOf("é");
  assert.deepEqual(originalRange(view, at, at + 1), [4, 6]);
  // Offsets after the composed letter still line up with the raw text.
  const year = view.text.indexOf("2017");
  assert.deepEqual(originalRange(view, year, year + 4), [15, 19]);
});

test("searchTextFromItems skips the space between an accent and its letter", () => {
  const view = searchTextFromItems([item("F¨ oldi´ ak", 0, 50)]);
  assert.equal(view.text, "Földiák");
});

test("searchTextFromItems drops an accent with no letter after it", () => {
  const view = searchTextFromItems([item("x´", 0, 10, true), item("1", 0, 5)]);
  assert.equal(view.text, "x 1");
});

test("matchAuthorYearText matches a split-accent citation to its reference", () => {
  const ref: ParsedReference = {
    index: 1,
    raw: "Ballé, J., Laparra, V. and Simoncelli, E. P. 2017. End-to-end optimized image compression.",
    page: 9,
    x: 40,
    y: 700,
    authors: ["Ballé", "Laparra", "Simoncelli"],
    year: 2017,
  };
  assert.deepEqual(matchAuthorYearText("Ball´e et al., 2017", [ref]), [1]);
  assert.deepEqual(matchAuthorYearText("Ball´ e et al. (2017)", [ref]), [1]);
});
