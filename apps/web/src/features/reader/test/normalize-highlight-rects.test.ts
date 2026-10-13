import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPdfAnchor, ReaderAnnotation } from "@weaveforge/core";
import { normalizeHighlightRects } from "../application/normalize-highlight-rects";
import { projectPageAnnotationGeometry } from "../application/project-annotation-geometry";

type Box = { left: number; top: number; width: number; height: number };

/** Area painted more than once: what shows up as a darker patch. */
function overlapArea(boxes: readonly Box[]): number {
  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (w > 1e-9 && h > 1e-9) total += w * h;
    }
  }
  return total;
}

/**
 * What `getClientRects()` returns over the pdf.js text layer for a two-line
 * selection: several spans per line, overlapping each other, and each line's
 * spans reaching into the next line (font ascent + descent exceeds the pitch).
 */
const SELECTION: number[][] = [
  // line 1, baseline ~700, pitch 12, span height 14
  [72, 698, 90, 712],
  [88, 698, 200, 712],
  [199, 698.5, 300, 711.5],
  // line 2
  [72, 686, 180, 700],
  [178, 686, 250, 700],
];

function highlight(rects: number[][], type: ReaderAnnotation["type"] = "highlight"): ReaderAnnotation {
  const anchor: CombinedPdfAnchor = { zoteroPosition: { pageIndex: 0, rects } };
  return {
    id: "h1",
    origin: "local",
    zoteroKey: null,
    type,
    color: "#5fb23680",
    text: "selected words",
    comment: "",
    tags: [],
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    anchor,
  };
}

function boxesOf(ann: ReaderAnnotation) {
  return projectPageAnnotationGeometry({
    annotations: [ann],
    pageNumber: 1,
    scale: 1,
    pageHeight: 792,
    pageWidth: 612,
    rotation: 0,
    contentHash: "",
  }).boxes;
}

test("a highlight paints no point of the page twice", () => {
  // The bug in the screenshot: darker bands where spans of one line overlap
  // and where one line's boxes reach into the next.
  const boxes = boxesOf(highlight(SELECTION));
  assert.equal(overlapArea(boxes), 0, `overlapping boxes: ${JSON.stringify(boxes)}`);
});

test("one band per line, covering what was selected", () => {
  const out = normalizeHighlightRects(SELECTION);
  assert.equal(out.length, 2);
  const [first, second] = out as [number[], number[]];
  assert.deepEqual([first[0], first[2]], [72, 300]);
  assert.deepEqual([second[0], second[2]], [72, 250]);
  // The lines meet in the middle of their overlap: no gap, no double paint.
  assert.equal(first[1], second[3]);
  assert.equal(first[3], 712);
  assert.equal(second[1], 686);
});

test("underlines are normalised too", () => {
  const boxes = boxesOf(highlight(SELECTION, "underline"));
  assert.equal(boxes.length, 2);
});

test("a gap wider than a word space stays a gap (two columns)", () => {
  const out = normalizeHighlightRects([
    [72, 700, 280, 712],
    [320, 700, 540, 712],
  ]);
  assert.equal(out.length, 2);
});

test("separate lines that do not touch are left alone", () => {
  const rects = [
    [72, 700, 300, 712],
    [72, 680, 300, 692],
  ];
  assert.deepEqual(normalizeHighlightRects(rects), rects);
});

test("bad rects are dropped and inverted corners repaired", () => {
  assert.deepEqual(
    normalizeHighlightRects([[300, 712, 72, 700], [1, 2, 3], [5, 5, 5, 9], [0, 0, Number.NaN, 1]]),
    [[72, 700, 300, 712]],
  );
});
