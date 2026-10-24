/**
 * One zoom table for every ink surface (20-03, 21-13, 23-14, xhelp-04): the
 * note canvas, the ink reader, the bar's buttons, keys, wheel and pinch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_ZOOM_MAX,
  INK_ZOOM_MIN,
  INK_ZOOM_STEP,
  clampInkZoom,
  inkZoomIn,
  inkZoomOut,
} from "../../src/ink/zoom.js";
import * as ink from "../../src/ink/index.js";

test("the ink zoom limits are 50% to 400%, one step 1.25x", () => {
  assert.equal(INK_ZOOM_MIN, 0.5);
  assert.equal(INK_ZOOM_MAX, 4);
  assert.equal(INK_ZOOM_STEP, 1.25);
});

test("clampInkZoom keeps a zoom inside the limits", () => {
  assert.equal(clampInkZoom(1), 1);
  assert.equal(clampInkZoom(0.5), 0.5);
  assert.equal(clampInkZoom(4), 4);
  assert.equal(clampInkZoom(0.49), 0.5);
  assert.equal(clampInkZoom(4.01), 4);
  assert.equal(clampInkZoom(Number.POSITIVE_INFINITY), 1);
});

test("a zoom that is not a positive number resets to 100%", () => {
  for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, 0, -2]) assert.equal(clampInkZoom(bad), 1, String(bad));
});

test("inkZoomIn and inkZoomOut take one step and stop at the limits", () => {
  assert.equal(inkZoomIn(1), 1.25);
  assert.equal(inkZoomOut(1), 0.8);
  assert.equal(inkZoomIn(3.5), 4);
  assert.equal(inkZoomIn(4), 4);
  assert.equal(inkZoomOut(0.6), 0.5);
  assert.equal(inkZoomOut(0.5), 0.5);
});

test("a wheel or pinch factor scales the zoom and is clamped", () => {
  assert.equal(clampInkZoom(2 * 1.1), 2 * 1.1);
  assert.equal(clampInkZoom(3.9 * 1.5), 4);
  assert.equal(clampInkZoom(0.6 * 0.5), 0.5);
});

test("the ink barrel exports the zoom table", () => {
  assert.equal(ink.INK_ZOOM_MAX, INK_ZOOM_MAX);
  assert.equal(ink.clampInkZoom, clampInkZoom);
});
