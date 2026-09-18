import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyFontSize,
  levenshtein,
  outlineFromText,
  outlineTextLines,
  textFingerprint,
  type OutlineTextItem,
} from "../../../src/features/reader/index.js";

const item = (str: string, fontSize = 10, page = 1, y = 700, fontName = "Regular"): OutlineTextItem =>
  ({ str, fontSize, page, y, x: 40, fontName });
/** Enough body to clear the 300-character floor and to pin the modal size. */
const body = (page = 1) =>
  Array.from({ length: 30 }, (_, i) => ({ ...item("Body text of the paper.", 10, page, 650 - i * 12), x: 40 + (i % 3) * 5 }));

test("detects numbered hierarchy, joins text runs and stops at References", () => {
  const pages = [[item("1 Introduction", 12), ...body(1)], [
    item("1.1 Related", 11, 2, 700, "Bold"),
    { ...item("work", 11, 2, 700), x: 110 },
    item("2 Results", 12, 2, 600),
    item("References", 12, 2, 500),
    item("Appendix", 14, 2, 300),
    ...body(2),
  ]];
  const outline = outlineFromText(pages);
  assert.deepEqual(outline.map((n) => n.title), ["1 Introduction", "2 Results", "References"]);
  assert.equal(outline[0]?.items?.[0]?.title, "1.1 Related work");
  assert.equal(outline[0]?.items?.[0]?.pageNumber, 2);
});

test("rejects running headers, long lines, unnumbered sentences and dotted leaders", () => {
  const pages = [1, 2, 3].map((page) => [item("Running header", 14, page), ...body(page)]);
  pages[0]!.push(
    item("Sentence.", 14),
    item("x".repeat(121), 14),
    item("Contents ........ 3", 14, 1, 640),
    item("Abstract", 10, 1, 200, "Heavy"),
    item("2 Method", 12, 2, 400),
    item("3 Results", 12, 3, 400),
  );
  assert.deepEqual(outlineFromText(pages).map((n) => n.title), ["Abstract", "2 Method", "3 Results"]);
});

test("treats near-identical lines on three pages as running heads", () => {
  const pages = [1, 2, 3].map((page) => [
    item(`Smith et al. — Deep Learning ${page}`, 14, page),
    ...body(page),
  ]);
  pages[0]!.push(item("1 Introduction", 12, 1, 400), item("2 Method", 12, 2, 400), item("3 Results", 12, 3, 400));
  assert.deepEqual(outlineFromText(pages).map((n) => n.title), ["1 Introduction", "2 Method", "3 Results"]);
});

test("returns nothing for fewer than three headings or a gap over half the document", () => {
  const two = [[item("1 Introduction", 12), ...body(1)], [item("2 Method", 12, 2), ...body(2)]];
  assert.deepEqual(outlineFromText(two), []);
  const gappy = Array.from({ length: 10 }, (_, i) => body(i + 1));
  gappy[0]!.push(item("1 Introduction", 12, 1, 400), item("2 Method", 12, 1, 300), item("3 Results", 12, 1, 200));
  assert.deepEqual(outlineFromText(gappy), []);
  gappy[4]!.push(item("4 Discussion", 12, 5, 400));
  assert.equal(outlineFromText(gappy).length, 4);
});

test("returns nothing for a document with under 300 characters of text", () => {
  const pages = [[item("1 Intro", 12), item("2 Body", 12, 1, 600), item("3 End", 12, 1, 500), item("text", 10)]];
  assert.deepEqual(outlineFromText(pages), []);
});

test("joins runs within three quarters of a line, then tightens when that fuses lines", () => {
  const loose = outlineTextLines([[item("1", 14), { ...item("Heading", 14, 1, 704), x: 60 }]]);
  assert.deepEqual(loose.map((line) => line.str), ["1 Heading"]);
  // Body lines 6pt apart at 10pt would fuse under the loose band; the tight pass keeps them apart.
  const tight = outlineTextLines([[
    item("one", 10, 1, 700), { ...item("two", 10, 1, 694), x: 50 }, { ...item("three", 10, 1, 688), x: 60 },
  ]]);
  assert.deepEqual(tight.map((line) => line.str), ["one", "two", "three"]);
});

test("levenshtein stops early past the limit", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("abc", "abc"), 0);
  assert.equal(levenshtein("abcdefgh", "xyz", 2), 3);
});

test("textFingerprint is stable, order-sensitive and sixteen hex characters", () => {
  const a = textFingerprint(["page one", "page two"]);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, textFingerprint(["page one", "page two"]));
  assert.notEqual(a, textFingerprint(["page two", "page one"]));
});

test("uses half-point modal sizes and handles empty documents", () => {
  assert.equal(bodyFontSize([[item("a", 9.9), item("b", 10.1), item("c", 12)]]), 10);
  assert.deepEqual(outlineFromText([]), []);
  assert.deepEqual(outlineFromText([[item("", 12)]]), []);
});
