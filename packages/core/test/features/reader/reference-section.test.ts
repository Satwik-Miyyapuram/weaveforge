import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REFERENCES_HEADING,
  findReferenceSection,
  furnitureLines,
  type TextLine,
} from "../../../src/features/reader/index.js";

/**
 * The shapes two real arXiv papers put the analysis in, reduced to the lines
 * that decide it. Both came back with no bibliography at all, for two
 * different reasons, and each one is pinned here.
 */
function line(
  text: string,
  page: number,
  options: { x?: number; y?: number; fontSize?: number; bold?: boolean } = {},
): TextLine {
  const x = options.x ?? 100;
  return {
    text,
    page,
    x,
    y: options.y ?? 700,
    right: x + text.length * 5,
    fontSize: options.fontSize ?? 10,
    bold: options.bold ?? false,
  };
}

test("a small-caps heading is a bibliography heading", () => {
  // pdf.js reports a small-caps heading as two runs, so IWAE's references read
  // "R EFERENCES". A literal-word pattern matches none of that, and the list is
  // never found — the paper cited 34 references and the reader said none.
  assert.equal(REFERENCES_HEADING.test("R EFERENCES"), true);
  assert.equal(REFERENCES_HEADING.test("References"), true);
  assert.equal(REFERENCES_HEADING.test("R E F E R E N C E S"), true);
  assert.equal(REFERENCES_HEADING.test("B IBLIOGRAPHY"), true);
  assert.equal(REFERENCES_HEADING.test("1 R EFERENCES"), true);
});

test("a single letter is never a bibliography heading", () => {
  // `k` is the bolded index of `L_k`, its own line inside a display equation.
  // Treating the small-caps tail as optional made every `k` on the page a
  // heading, and `findReferenceSection` keeps the last candidate — so the
  // equations after the real list beat it and the references came back as
  // algebra. Display-equation fragments must not match either.
  for (const text of ["k", "m", "i =1", "L k = E h 1 ,..., h k", "p ( x | θ ) =", "(17)"]) {
    assert.equal(REFERENCES_HEADING.test(text), false, text);
  }
});

test("a heading that recurs in the margin band is not page furniture", () => {
  // InfoGAN lists its bibliography on page 8 and labels the appendix's second
  // listing "References" too. Both start at the page's left margin, so the
  // margin-band rule counted them as band lines, and recurring made them look
  // like a running head — while `findReferenceSection` refuses a heading that is
  // furniture, so the document looked like it had no bibliography at all.
  const lines: TextLine[] = [];
  for (const page of [1, 2, 8, 13]) lines.push(line("References", page, { x: 105, y: 200 }));
  for (const page of [1, 2, 13]) {
    lines.push(line("Under review as a conference paper at ICLR 2016", page, { x: 108, y: 756 }));
  }
  const furniture = furnitureLines(lines);

  for (const heading of lines.filter((l) => l.text === "References")) {
    assert.equal(furniture.has(heading), false, `page ${heading.page}`);
  }
  // The banner still is furniture: the guard is for headings, not a blanket
  // amnesty for everything in the band or everything that repeats.
  const banner = lines.find((l) => l.text.startsWith("Under review"))!;
  assert.equal(furniture.has(banner), true);
});

test("the heading followed by the real list wins over a later one", () => {
  // Both headings score the same on position and weight, so the choice is the
  // list underneath: InfoGAN's bibliography is 30 entries and the appendix's
  // re-listing is 6. Keeping the later heading returned those six and reported
  // a 35-reference paper as almost uncited.
  const lines: TextLine[] = [];
  let y = 700;
  lines.push(line("8 Conclusion", 7, { y }));
  // The real bibliography, on page 8.
  lines.push(line("References", 8, { x: 105, y: 200 }));
  for (let n = 1; n <= 30; n++) lines.push(line(`[${n}] Author ${n}. 20${10 + (n % 10)}. A title.`, 8, { y: 190 - n }));
  // The appendix, later, with a much shorter list of its own.
  lines.push(line("B I NTRODUCTION TO C OMPARISON", 12, { y: 700 }));
  lines.push(line("References", 13, { x: 105, y: 200 }));
  for (let n = 1; n <= 6; n++) lines.push(line(`[${n}] Author ${n}. 1995. Another title.`, 13, { y: 190 - n }));

  const span = findReferenceSection(lines, { bodyFontSize: 10, pageCount: 14, furniture: new Set() });
  assert.ok(span, "a reference section was found");
  assert.equal(lines[span!.headingIndex]!.page, 8, "the page-8 heading, not the appendix's");
  assert.equal(span!.start, 2);
});

test("a document with one heading still picks it", () => {
  // A small-caps heading with an entry-bearing list under it. The entries have
  // to be there: the heading alone cannot clear the evidence threshold, which is
  // the point of that rule — and is why IWAE needed the heading pattern fixed
  // *and* the entries underneath it recognised.
  const lines = [line("5 E XPERIMENTAL RESULTS", 6, { y: 700 })];
  lines.push(line("R EFERENCES", 8, { x: 116, y: 141 }));
  for (let n = 1; n <= 8; n++) {
    lines.push(line(`[${n}] Author${n}, A. 2015. A title of some length.`, 8, { y: 130 - n * 11 }));
  }
  const span = findReferenceSection(lines, { bodyFontSize: 10, pageCount: 14, furniture: new Set() });
  assert.ok(span, "the small-caps heading is found");
  assert.equal(span!.headingIndex, 1);
});

test("a numbered run still falls back when no heading is present", () => {
  const lines: TextLine[] = [];
  for (let n = 1; n <= 6; n++) lines.push(line(`${n}. Author ${n}. 2019. A title.`, 7, { y: 700 - n * 12 }));
  const span = findReferenceSection(lines, { bodyFontSize: 10, pageCount: 8, furniture: new Set() });
  assert.ok(span, "the numbered run is found without a heading");
  assert.equal(span!.headingIndex, -1);
});
