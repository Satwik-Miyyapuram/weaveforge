/**
 * Cutting a stroke at the edge of the area it may be drawn in.
 *
 * What is pinned here is the printing rule: the ink that lands on the sheet is
 * on the sheet, and the pen's travel outside it leaves no mark — and, just as
 * important, that the return is a *new* stroke rather than a straight line
 * across whatever the pen passed over.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clipSegmentToArea,
  pointInArea,
  type DrawArea,
} from "../application/clip-to-area";

/** A page: 100 wide, 200 tall, starting at (10, 20). */
const AREA: DrawArea = { left: 10, top: 20, right: 110, bottom: 220 };

/** A point to the pixel: the clip is a division, so the last bit is float noise. */
function px(point: { x: number; y: number } | undefined) {
  return point ? { x: Math.round(point.x), y: Math.round(point.y) } : point;
}

test("a point is in the page or it is not, edges included", () => {
  assert.equal(pointInArea(AREA, 50, 100), true);
  assert.equal(pointInArea(AREA, 10, 20), true);
  assert.equal(pointInArea(AREA, 110, 220), true);
  assert.equal(pointInArea(AREA, 9, 100), false);
  assert.equal(pointInArea(AREA, 50, 221), false);
});

test("a segment wholly inside is returned as it is", () => {
  const clipped = clipSegmentToArea(AREA, { x: 20, y: 30 }, { x: 90, y: 200 });
  assert.deepEqual(clipped, { from: { x: 20, y: 30 }, to: { x: 90, y: 200 } });
});

test("a segment that runs off the right edge is cut where it crosses", () => {
  // Left to right, leaving through the right edge at x = 110.
  const clipped = clipSegmentToArea(AREA, { x: 50, y: 100 }, { x: 200, y: 100 });
  assert.ok(clipped);
  assert.deepEqual(clipped.from, { x: 50, y: 100 });
  assert.equal(clipped.to.x, 110);
  assert.equal(clipped.to.y, 100);
});

test("a segment that comes back in starts at the edge it crossed", () => {
  // From outside on the left, coming in: the part that counts begins at x = 10.
  const clipped = clipSegmentToArea(AREA, { x: -40, y: 60 }, { x: 60, y: 60 });
  assert.ok(clipped);
  assert.equal(clipped.from.x, 10);
  assert.equal(clipped.from.y, 60);
  assert.deepEqual(clipped.to, { x: 60, y: 60 });
});

test("a segment that only passes over the page is cut to the crossing, both ends", () => {
  // Diagonally across a corner: in at the top, out at the right. Compared to the
  // pixel, because the clip is a division and the last bit is float noise.
  const clipped = clipSegmentToArea(AREA, { x: 0, y: 0 }, { x: 200, y: 200 });
  assert.ok(clipped);
  // y = x, and the page starts at (10, 20) → in at (20, 20); ends at x = 110 → (110, 110).
  assert.deepEqual(px(clipped.from), { x: 20, y: 20 });
  assert.deepEqual(px(clipped.to), { x: 110, y: 110 });
});

test("a segment that misses the page entirely is nothing", () => {
  assert.equal(clipSegmentToArea(AREA, { x: -50, y: -50 }, { x: -10, y: 300 }), null);
  assert.equal(clipSegmentToArea(AREA, { x: 200, y: 0 }, { x: 300, y: 400 }), null);
  // Parallel to an edge and outside it.
  assert.equal(clipSegmentToArea(AREA, { x: 5, y: 30 }, { x: 5, y: 200 }), null);
});

test("a segment along an edge is on the page, not off it", () => {
  const clipped = clipSegmentToArea(AREA, { x: 10, y: 0 }, { x: 10, y: 300 });
  assert.ok(clipped, "the left edge itself is inside");
  assert.deepEqual(clipped.from, { x: 10, y: 20 });
  // To the pixel: the parameter is a division, so the last bit is float noise.
  assert.equal(Math.round(clipped.to.y), 220);
  assert.equal(clipped.to.x, 10);
});
