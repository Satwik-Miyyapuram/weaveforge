/**
 * The lasso's arithmetic: is a point in the loop, and has the loop caught a
 * stroke?
 *
 * What is pinned here is the rule that decides whether a mark is picked up —
 * most of a stroke inside the loop, not any part of it touching — because that
 * is the difference between lassoing the sentence you drew a ring round and
 * lassoing every stroke whose tail crosses the ring on its way elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LASSO_CAUGHT_SHARE,
  inkPathsInPolygon,
  pointInPolygon,
} from "../../src/reader/ink-lasso.js";

/** A square loop, 100 wide, from (0,0) to (100,100). */
const SQUARE = [0, 0, 100, 0, 100, 100, 0, 100];

test("a point is in the loop or it is not, up to the loop's own line", () => {
  assert.equal(pointInPolygon(SQUARE, 50, 50), true);
  assert.equal(pointInPolygon(SQUARE, -1, 50), false);
  assert.equal(pointInPolygon(SQUARE, 50, 101), false);
  // Right up to the line the hand drew counts as in, and a hair past it does
  // not. Exactly *on* the line is the ray-casting rule's own business and
  // deliberately not pinned: a mark sitting on the boundary to the pixel is
  // never what decides a lasso.
  assert.equal(pointInPolygon(SQUARE, 99.5, 50), true);
  assert.equal(pointInPolygon(SQUARE, 100.5, 50), false);
});

test("a loop with too few points holds nothing", () => {
  // Two points are a line, not an area; a press-and-release lasso must not
  // catch the whole page because the polygon arithmetic degenerated.
  assert.equal(pointInPolygon([0, 0, 10, 10], 5, 5), false);
  assert.equal(inkPathsInPolygon([[0, 0, 10, 10]], [0, 0, 10, 10]), false);
});

test("a stroke is caught when most of it is inside the loop", () => {
  const inside = [10, 10, 50, 50, 90, 90];
  assert.equal(inkPathsInPolygon([inside], SQUARE), true);
});

test("a stroke that merely crosses the loop is not caught", () => {
  // A line running right through the loop, most of its length outside: only two
  // of its five samples are in. OneNote's rule keeps it out, and that is what
  // makes a ring round one word select the word and not the line it sits on.
  const throughLine = [-500, 50, -100, 50, 50, 50, 100, 50, 500, 50];
  assert.equal(inkPathsInPolygon([throughLine], SQUARE), false);
  // The same rule the other way: a stroke mostly inside is caught even though
  // its ends are not.
  assert.equal(inkPathsInPolygon([[10, 50, 50, 50, 90, 50]], SQUARE), true);
  // The share is what decides it — just under, and it is out.
  const justUnder = [10, 50, 50, 50, 150, 50, 250, 50];
  assert.ok(2 / 4 < LASSO_CAUGHT_SHARE);
  assert.equal(inkPathsInPolygon([justUnder], SQUARE), false);
});

test("a multi-stroke mark is judged on all of its strokes together", () => {
  // One annotation can hold many strokes (a word written in one breath). One
  // stroke outside the loop and one inside is half the mark, under the share.
  assert.equal(
    inkPathsInPolygon([[10, 10, 90, 90], [500, 500, 600, 600]], SQUARE),
    false,
  );
  assert.equal(
    inkPathsInPolygon([[10, 10, 90, 90], [20, 20, 80, 80]], SQUARE),
    true,
  );
});

test("points that are not numbers are skipped rather than counted against it", () => {
  assert.equal(inkPathsInPolygon([[NaN, 0, 50, 50, 60, 60]], SQUARE), true);
  assert.equal(inkPathsInPolygon([[]], SQUARE), false);
});
