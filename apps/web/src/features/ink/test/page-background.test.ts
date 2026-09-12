/**
 * The A4 sheet: every inserted page is A4, and a source of another shape
 * sits inside it rather than being stretched to it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  A4_RASTER_HEIGHT,
  A4_RASTER_WIDTH,
  isPageSource,
  placeOnSheet,
} from "../application/page-background";

test("the sheet is A4 at 200 dpi", () => {
  assert.equal(A4_RASTER_WIDTH, 1654);
  assert.equal(A4_RASTER_HEIGHT, 2339);
  // 2100 : 2970, within a pixel of rounding.
  assert.ok(Math.abs(A4_RASTER_WIDTH / A4_RASTER_HEIGHT - 2100 / 2970) < 0.001);
});

test("an A4 source fills the sheet", () => {
  assert.deepEqual(placeOnSheet(2100, 2970), {
    x: 0,
    y: 0,
    width: A4_RASTER_WIDTH,
    height: A4_RASTER_HEIGHT,
  });
});

test("a landscape source spans the width and is centred vertically", () => {
  const box = placeOnSheet(1600, 800);
  assert.equal(box.width, A4_RASTER_WIDTH);
  assert.equal(box.height, 827);
  assert.equal(box.x, 0);
  assert.equal(box.y, Math.round((A4_RASTER_HEIGHT - 827) / 2));
});

test("a tall source spans the height and is centred horizontally", () => {
  const box = placeOnSheet(100, 1000);
  assert.equal(box.height, A4_RASTER_HEIGHT);
  assert.equal(box.width, 234);
  assert.equal(box.x, Math.round((A4_RASTER_WIDTH - 234) / 2));
});

test("a small source is enlarged to the sheet: a background covers the page", () => {
  const box = placeOnSheet(210, 297);
  assert.equal(box.width, A4_RASTER_WIDTH);
});

test("PDFs and images are page sources; anything else is not", () => {
  assert.ok(isPageSource({ type: "application/pdf", name: "a.pdf" }));
  assert.ok(isPageSource({ type: "", name: "scan.PDF" }));
  assert.ok(isPageSource({ type: "image/png", name: "shot.png" }));
  assert.ok(!isPageSource({ type: "text/plain", name: "notes.txt" }));
});
