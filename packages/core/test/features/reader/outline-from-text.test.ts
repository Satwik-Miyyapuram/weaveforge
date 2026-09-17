import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyFontSize, outlineFromText, type OutlineTextItem } from "../../../src/features/reader/index.js";

const item = (str: string, fontSize = 10, page = 1, y = 700, fontName = "Regular"): OutlineTextItem =>
  ({ str, fontSize, page, y, x: 40, fontName });
const body = Array.from({ length: 20 }, (_, i) => item("Body text", 10, 1, 650 - i * 12));

test("detects numbered hierarchy, joins text runs and stops at References", () => {
  const pages = [[item("1 Introduction", 12), ...body], [
    item("1.1 Related", 11, 2, 700, "Bold"),
    { ...item("work", 11, 2, 700), x: 110 },
    item("2 Results", 12, 2, 600),
    item("References", 12, 2, 500),
    item("Appendix", 14, 2, 300),
  ]];
  const outline = outlineFromText(pages);
  assert.deepEqual(outline.map((n) => n.title), ["1 Introduction", "2 Results", "References"]);
  assert.equal(outline[0]?.items?.[0]?.title, "1.1 Related work");
  assert.equal(outline[0]?.items?.[0]?.pageNumber, 2);
});

test("rejects running headers, long lines and unnumbered sentences", () => {
  const pages = [1, 2, 3].map((page) => [item("Running header", 14, page), ...body.map((b) => ({ ...b, page }))]);
  pages[0]!.push(item("Sentence.", 14), item("x".repeat(121), 14), item("Abstract", 10, 1, 200, "Heavy"));
  assert.deepEqual(outlineFromText(pages).map((n) => n.title), ["Abstract"]);
});

test("uses half-point modal sizes and handles empty documents", () => {
  assert.equal(bodyFontSize([[item("a", 9.9), item("b", 10.1), item("c", 12)]]), 10);
  assert.deepEqual(outlineFromText([]), []);
  assert.deepEqual(outlineFromText([[item("", 12)]]), []);
});
