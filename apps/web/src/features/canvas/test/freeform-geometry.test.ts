import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_SIZE,
  PICTURE_MAX_WIDTH,
  TEXT_WIDTH,
  ZOOM_MAX,
  ZOOM_MIN,
  pictureSize,
  placeText,
  resizeKeepAspect,
  resizeWidth,
  screenToPage,
  zoomAt,
} from "../application/freeform-geometry";

test("a new text box is 320 wide and starts at the pointer, rounded to whole page pixels", () => {
  assert.equal(TEXT_WIDTH, 320);
  const box = placeText({ x: 10.4, y: 99.6 });
  assert.equal(box.x, 10);
  assert.equal(box.y, 100);
  assert.equal(box.width, 320);
  assert.ok(box.height >= MIN_SIZE);
});

test("a picture keeps its natural size when it is no wider than 640", () => {
  assert.deepEqual(pictureSize({ width: 400, height: 300 }), { width: 400, height: 300 });
});

test("a wider picture is capped at 640 wide and keeps its aspect ratio", () => {
  assert.equal(PICTURE_MAX_WIDTH, 640);
  assert.deepEqual(pictureSize({ width: 1280, height: 960 }), { width: 640, height: 480 });
});

test("a picture that is not a usable size falls back to the minimum", () => {
  const size = pictureSize({ width: 0, height: 0 });
  assert.ok(size.width >= MIN_SIZE);
  assert.ok(size.height >= MIN_SIZE);
});

test("a corner resize keeps the aspect ratio", () => {
  const next = resizeKeepAspect({ width: 200, height: 100 }, 50);
  assert.deepEqual(next, { width: 250, height: 125 });
});

test("a corner resize never goes below the minimum size", () => {
  const next = resizeKeepAspect({ width: 200, height: 100 }, -500);
  assert.equal(next.height, MIN_SIZE);
  assert.equal(next.width, MIN_SIZE * 2);
});

test("a width resize changes only the width and stops at the minimum", () => {
  assert.equal(resizeWidth(320, 40), 360);
  assert.equal(resizeWidth(320, -1000), MIN_SIZE);
});

test("a screen point maps to the page through the view offset and zoom", () => {
  const view = { x: 100, y: 50, zoom: 2 };
  assert.deepEqual(screenToPage(view, { x: 300, y: 250 }), { x: 100, y: 100 });
});

test("zooming keeps the page point under the pointer where it was", () => {
  const view = { x: 0, y: 0, zoom: 1 };
  const pointer = { x: 200, y: 100 };
  const before = screenToPage(view, pointer);
  const next = zoomAt(view, pointer, 2);
  assert.equal(next.zoom, 2);
  assert.deepEqual(screenToPage(next, pointer), before);
});

test("zoom is clamped between 0.1 and 4", () => {
  assert.equal(ZOOM_MIN, 0.1);
  assert.equal(ZOOM_MAX, 4);
  assert.equal(zoomAt({ x: 0, y: 0, zoom: 3.9 }, { x: 0, y: 0 }, 10).zoom, 4);
  assert.equal(zoomAt({ x: 0, y: 0, zoom: 0.2 }, { x: 0, y: 0 }, 0.01).zoom, 0.1);
});
