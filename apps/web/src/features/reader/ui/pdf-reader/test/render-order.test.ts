/**
 * Pages repaint one at a time after a zoom, so the order decides how long the
 * page in view stays at the old size. The one on screen goes first, then the
 * rest by how far they are from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { nearestFirst } from "../render-order";

test("the page under the viewport centre goes first, then outward", () => {
  // Viewport 1000..2000; pages 1000 tall, document order 1..4.
  const pages = [
    { page: 1, top: 0, bottom: 1000 },
    { page: 2, top: 1000, bottom: 2000 },
    { page: 3, top: 2000, bottom: 3000 },
    { page: 4, top: 3000, bottom: 4000 },
  ];
  assert.deepEqual(nearestFirst(pages, 1500), [2, 1, 3, 4]);
});

test("a page straddling the centre beats a nearer-edged one", () => {
  const pages = [
    { page: 5, top: 100, bottom: 400 },
    { page: 6, top: 450, bottom: 1450 },
  ];
  assert.deepEqual(nearestFirst(pages, 500), [6, 5]);
});

test("ties keep document order", () => {
  const pages = [
    { page: 1, top: 0, bottom: 100 },
    { page: 2, top: 200, bottom: 300 },
  ];
  assert.deepEqual(nearestFirst(pages, 150), [1, 2]);
});

test("no pages gives no order", () => {
  assert.deepEqual(nearestFirst([], 0), []);
});
