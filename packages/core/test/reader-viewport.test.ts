import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPage,
  clampScale,
  computeFitPageScale,
  computeFitWidthScale,
  initialReaderViewport,
  nextRotation,
  READER_MAX_SCALE,
  READER_MIN_SCALE,
  resolveViewportScale,
  visualPageSize,
  zoomIn,
  zoomOut,
} from "../src/reader/reader-viewport.js";

test("clampScale rejects non-finite and zero, then clamps to range", () => {
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(0), 1);
  assert.equal(clampScale(-2), 1);
  assert.equal(clampScale(0.1), READER_MIN_SCALE);
  assert.equal(clampScale(99), READER_MAX_SCALE);
  assert.equal(clampScale(1.5), 1.5);
});

test("computeFitWidthScale fills container width with gutter", () => {
  const scale = computeFitWidthScale(
    { width: 600, height: 800 },
    { width: 624, height: 900 },
    0,
    24,
  );
  assert.equal(scale, 1); // (624 - 24) / 600 = 1
});

test("computeFitWidthScale uses rotated visual width", () => {
  // 90° swaps dimensions: visual width becomes 800
  const scale = computeFitWidthScale(
    { width: 600, height: 800 },
    { width: 824, height: 900 },
    90,
    24,
  );
  assert.equal(scale, 1); // (824 - 24) / 800 = 1
});

test("computeFitPageScale picks the tighter axis", () => {
  const scale = computeFitPageScale(
    { width: 600, height: 800 },
    { width: 324, height: 424 },
    0,
    24,
  );
  // byW = 300/600 = 0.5; byH = 400/800 = 0.5
  assert.equal(scale, 0.5);
});

test("computeFitPageScale is limited by height when the pane is short", () => {
  const scale = computeFitPageScale(
    { width: 600, height: 800 },
    { width: 1224, height: 224 },
    0,
    24,
  );
  // byW = 2, byH = 200/800 = 0.25 → 0.25
  assert.equal(scale, 0.25);
});

test("visualPageSize swaps axes at 90 and 270", () => {
  const page = { width: 100, height: 200 };
  assert.deepEqual(visualPageSize(page, 0), page);
  assert.deepEqual(visualPageSize(page, 180), page);
  assert.deepEqual(visualPageSize(page, 90), { width: 200, height: 100 });
  assert.deepEqual(visualPageSize(page, 270), { width: 200, height: 100 });
});

test("zoomIn / zoomOut step and clamp", () => {
  assert.equal(zoomIn(1), 1.25);
  assert.equal(zoomOut(1.25), 1);
  assert.equal(zoomOut(READER_MIN_SCALE), READER_MIN_SCALE);
  assert.equal(zoomIn(READER_MAX_SCALE), READER_MAX_SCALE);
});

test("nextRotation wraps through the four cardinals", () => {
  assert.equal(nextRotation(0), 90);
  assert.equal(nextRotation(90), 180);
  assert.equal(nextRotation(180), 270);
  assert.equal(nextRotation(270), 0);
  assert.equal(nextRotation(0, -90), 270);
  assert.equal(nextRotation(90, -90), 0);
});

test("clampPage is 1-based and inclusive of numPages", () => {
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(1.4, 10), 1);
  assert.equal(clampPage(1.6, 10), 2);
  assert.equal(clampPage(99, 10), 10);
  assert.equal(clampPage(5, 0), 1);
  assert.equal(clampPage(NaN, 10), 1);
});

test("resolveViewportScale respects fit modes", () => {
  const page = { width: 500, height: 700 };
  const container = { width: 524, height: 724 };
  assert.equal(
    resolveViewportScale({ scale: 2, fit: "width", rotation: 0 }, page, container),
    1,
  );
  assert.equal(
    resolveViewportScale({ scale: 2, fit: "page", rotation: 0 }, page, container),
    1,
  );
  assert.equal(
    resolveViewportScale({ scale: 2, fit: "custom", rotation: 0 }, page, container),
    2,
  );
});

test("initialReaderViewport defaults to fit-width", () => {
  const state = initialReaderViewport(3);
  assert.equal(state.fit, "width");
  assert.equal(state.rotation, 0);
  assert.equal(state.page, 3);
  assert.equal(state.scale, 1);
});
