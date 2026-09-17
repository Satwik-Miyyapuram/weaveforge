/**
 * Line segmentation: which strokes a recogniser is handed as one line (§5.4).
 *
 * The test strokes are built the way a page is: a run of strokes along one line,
 * then a run along the next, each carrying the start time a digitiser would
 * report. What is asserted is the property the recogniser depends on — a line is
 * the strokes of one written row, in reading order, and never a highlighter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_GROUP_WINDOW_MS,
  applyInkSegmentation,
  inkLineStrokes,
  inkStrokeBand,
  segmentInkLines,
} from "../../src/ink/segment.js";
import { makeInkStroke, type InkStroke } from "../../src/ink/ink-note.js";

/** A stroke of `count` points along a row centred on `y`. */
function row(y: number, t0: number, options: Partial<InkStroke> = {}): InkStroke {
  const points: number[] = [];
  for (let i = 0; i < 8; i += 1) points.push(100 + i * 12, y + (i % 2 === 0 ? -6 : 6));
  return makeInkStroke({
    points,
    pressures: points.map((_value, index) => 100 + index * 8),
    t0,
    ...options,
  });
}

test("a stroke's band is its vertical extent", () => {
  assert.deepEqual(inkStrokeBand(row(500, 0)), [494, 506]);
  assert.equal(inkStrokeBand(makeInkStroke({ points: [] })), null);
});

test("strokes written along one row become one line, top to bottom", () => {
  const strokes = [
    row(300, 0),
    row(302, 400),
    row(298, 800),
    // A second row, written after the first and below it.
    row(600, 1_600),
    row(598, 2_000),
  ];
  const { lines, lineOfStroke } = segmentInkLines(strokes);
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines[0]!.strokes.map((stroke) => stroke.points[1]),
    [294, 296, 292],
    "the row's strokes, in the order they were written",
  );
  assert.deepEqual(lines[0]!.yBand, [292, 308]);
  assert.deepEqual(lines[1]!.yBand, [592, 606]);
  assert.deepEqual(lineOfStroke, [0, 0, 0, 1, 1]);
});

test("a row written out of order still comes back in reading order", () => {
  // Written top row, then a note in the margin above it, then the top row again.
  // Grouping is by time, so the second visit to the top row is its own line —
  // what matters is that the *body* order is top to bottom, not write order.
  const strokes = [row(700, 0), row(702, 100), row(200, 400), row(700, 700)];
  const { lines } = segmentInkLines(strokes);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0]!.yBand, [194, 206], "the margin note reads first");
  assert.deepEqual(lines[1]!.yBand, [694, 708], "two visits to the top row, written together");
  assert.deepEqual(lines[2]!.yBand, [694, 706]);
  assert.deepEqual(
    lines.map((line) => line.strokes.map((stroke) => stroke.points[1])),
    [[194], [694, 696], [694]],
  );
});

test("a gap longer than the grouping window starts a new line", () => {
  const strokes = [row(300, 0), row(302, INK_GROUP_WINDOW_MS + 1)];
  assert.equal(segmentInkLines(strokes).lines.length, 2);
  assert.equal(segmentInkLines([row(300, 0), row(302, INK_GROUP_WINDOW_MS - 1)]).lines.length, 1);
});

test("a stroke a row away is never joined, however soon it was written", () => {
  const strokes = [row(300, 0), row(420, 100)];
  const { lines } = segmentInkLines(strokes);
  assert.equal(lines.length, 2);
});

test("highlighters and shapes are not writing, so they are never segmented", () => {
  const strokes = [
    row(300, 0),
    row(300, 50, { tool: "highlighter", width: 60 }),
    row(600, 100, { tool: "shape", shape: "rect" }),
    row(302, 200),
  ];
  const { lines, lineOfStroke } = segmentInkLines(strokes);
  assert.equal(lines.length, 1, "only the pen strokes make a line");
  assert.equal(lines[0]!.strokes.length, 2);
  assert.deepEqual(lineOfStroke, [0, -1, -1, 0]);
});

test("a stroke too short to be a stroke is left out", () => {
  const dot = makeInkStroke({ points: [10, 10], tool: "pen", t0: 0 });
  const { lines, lineOfStroke } = segmentInkLines([dot]);
  assert.equal(lines.length, 0);
  assert.deepEqual(lineOfStroke, [-1]);
});

test("segmentation groups the page's strokes and records each line", () => {
  const strokes = [row(300, 0), row(302, 300), row(600, 1_200)];
  const segmentation = segmentInkLines(strokes);
  const recognised = [
    { text: "Drop the β sweep", confidence: 0.93 },
    { text: "[[Graph-prior module]]", confidence: 0.5 },
  ];
  const { strokes: grouped, lines } = applyInkSegmentation(strokes, segmentation, recognised);

  assert.equal(grouped.length, 3, "no stroke is lost or duplicated");
  assert.deepEqual(grouped.map((stroke) => stroke.lineIndex), [0, 0, 1]);
  assert.deepEqual(lines.map((line) => line.text), ["Drop the β sweep", "[[Graph-prior module]]"]);
  assert.deepEqual(lines.map((line) => line.strokeStart), [0, 2]);
  assert.deepEqual(lines.map((line) => line.strokeCount), [2, 1]);
  assert.equal(lines[0]!.confidence, 0.93);
  assert.equal(lines[1]!.confidence, 0.5);
  // A line's range is how the container names its strokes, so it has to be exact.
  assert.equal(inkLineStrokes(grouped, lines[0]!).length, 2);
  assert.equal(inkLineStrokes(grouped, lines[1]!)[0]!.lineIndex, 1);
});

test("strokes that were never segmented keep their order after the lines", () => {
  const highlight = row(300, 0, { tool: "highlighter", width: 60 });
  const strokes = [row(300, 100), highlight];
  const segmentation = segmentInkLines(strokes);
  const { strokes: grouped, lines } = applyInkSegmentation(strokes, segmentation);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[1]!.tool, "highlighter");
  assert.equal(grouped[1]!.lineIndex, -1);
  assert.equal(lines.length, 1);
});

test("an unrecognised line records an empty text rather than no line", () => {
  const strokes = [row(300, 0), row(600, 1_000)];
  const segmentation = segmentInkLines(strokes);
  const { lines } = applyInkSegmentation(strokes, segmentation);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.text), ["", ""]);
  assert.deepEqual(lines.map((line) => line.confidence), [0, 0]);
});

test("an empty page segments to nothing at all", () => {
  const segmentation = segmentInkLines([]);
  assert.deepEqual(segmentation.lines, []);
  assert.deepEqual(segmentation.lineOfStroke, []);
  assert.deepEqual(applyInkSegmentation([], segmentation), { strokes: [], lines: [] });
});
