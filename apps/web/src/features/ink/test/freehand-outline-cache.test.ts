/**
 * The freehand outline is computed once per stroke and reused while the stroke
 * is unchanged: same id, same point count, same width and `last`. A paint is
 * then a walk over cached curves, not a path build and a regex parse.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { freedrawPath } from "../render/excalidraw-freedraw";
import { FreehandOutlineCache, freedrawCurves } from "../render/freehand-stroke";

const X = Float32Array.from([0, 40, 90, 150, 220]);
const Y = Float32Array.from([0, 20, 10, 40, 30]);
const P = Uint8Array.from([128, 128, 128, 128, 128]);

test("an unchanged stroke gets the same outline object back", () => {
  const cache = new FreehandOutlineCache();
  const first = cache.outline(1, X, Y, P, 6, true);
  assert.ok(first);
  assert.equal(cache.outline(1, X, Y, P, 6, true), first);
  assert.deepEqual(first, freedrawCurves(freedrawPath(X, Y, 6, true, P)));
});

test("a new point, width or `last` is a new outline", () => {
  const cache = new FreehandOutlineCache();
  const first = cache.outline(1, X, Y, P, 6, true);
  assert.notEqual(cache.outline(1, X.subarray(0, 4), Y.subarray(0, 4), P.subarray(0, 4), 6, true), first);
  assert.notEqual(cache.outline(1, X, Y, P, 8, true), cache.outline(1, X, Y, P, 6, true));
  assert.notEqual(cache.outline(1, X, Y, P, 6, false), cache.outline(1, X, Y, P, 6, true));
});

test("a stroke and its selection halo are both kept", () => {
  const cache = new FreehandOutlineCache();
  const body = cache.outline(1, X, Y, P, 6, true);
  const halo = cache.outline(1, X, Y, P, 10, true);
  assert.equal(cache.outline(1, X, Y, P, 6, true), body);
  assert.equal(cache.outline(1, X, Y, P, 10, true), halo);
});

test("forget and clear drop a stroke's outline, so an in-place edit is seen", () => {
  const cache = new FreehandOutlineCache();
  const x = Float32Array.from(X);
  const first = cache.outline(1, x, Y, P, 6, true);
  for (let i = 0; i < x.length; i += 1) x[i] = x[i]! + 50;
  assert.equal(cache.outline(1, x, Y, P, 6, true), first, "same id and count: cached");
  cache.forget(1);
  const moved = cache.outline(1, x, Y, P, 6, true);
  assert.notEqual(moved, first);
  assert.deepEqual(moved, freedrawCurves(freedrawPath(x, Y, 6, true, P)));
  cache.clear();
  assert.notEqual(cache.outline(1, x, Y, P, 6, true), moved);
});

test("ids are separate", () => {
  const cache = new FreehandOutlineCache();
  assert.notEqual(cache.outline(1, X, Y, P, 6, true), cache.outline(2, X, Y, P, 6, true));
});
