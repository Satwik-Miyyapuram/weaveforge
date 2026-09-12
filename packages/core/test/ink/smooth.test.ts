import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INK_SMOOTH_SPACING,
  binomialSmooth,
  resampleInkStroke,
  smoothInkStroke,
} from "../../src/ink/smooth.js";

test("resampling spaces the points evenly and keeps both ends", () => {
  // Uneven samples on a straight run, 20 units long: the spacing is measured
  // along the path, so a corner would shorten a chord; a line shows the rule.
  const points = [0, 0, 3, 0, 10, 0, 20, 0];
  const { points: out, pressures } = resampleInkStroke(points, [0.2, 0.4, 0.6, 1], 4);
  assert.deepEqual(out.slice(0, 2), [0, 0]);
  assert.deepEqual(out.slice(-2), [20, 0]);
  for (let i = 2; i + 3 < out.length; i += 2) {
    const step = Math.hypot(out[i + 2]! - out[i]!, out[i + 3]! - out[i + 1]!);
    assert.ok(Math.abs(step - 4) < 1e-9, `step ${i / 2} is ${step}`);
  }
  assert.equal(pressures.length, out.length / 2);
  assert.equal(pressures[0], 0.2);
  assert.equal(pressures.at(-1), 1);
  assert.ok(pressures[1]! > 0.4 && pressures[1]! < 0.6, "pressure rides along");
});

test("resampling does not double the last point", () => {
  const { points } = resampleInkStroke([0, 0, 8, 0], [0, 0], 4);
  assert.deepEqual(points, [0, 0, 4, 0, 8, 0]);
});

test("a dot or a pair of samples passes through untouched", () => {
  assert.deepEqual(resampleInkStroke([3, 4], [1], 4).points, [3, 4]);
  assert.deepEqual(smoothInkStroke([0, 0, 1, 0], [0, 0]).points, [0, 0, 1, 0]);
});

test("the kernel takes the jitter out of a line and pins its ends", () => {
  const jittered: number[] = [];
  for (let i = 0; i <= 20; i += 1) jittered.push(i * 3, i % 2 === 0 ? 0.4 : -0.4);
  const out = binomialSmooth(jittered, 2);
  assert.deepEqual(out.slice(0, 2), [0, 0.4]);
  assert.deepEqual(out.slice(-2), [60, 0.4]);
  for (let i = 3; i < 18; i += 1) {
    assert.ok(Math.abs(out[i * 2 + 1]!) < 0.1, `sample ${i} still wobbles: ${out[i * 2 + 1]}`);
  }
  assert.equal(out[10 * 2], 30, "the along-stroke position is unchanged on an even line");
});

test("a curve keeps its shape: the smoothed arc stays on the circle", () => {
  const points: number[] = [];
  const pressures: number[] = [];
  const radius = 100; // a 10 mm arc
  for (let i = 0; i <= 60; i += 1) {
    const angle = (i / 60) * Math.PI;
    points.push(radius * Math.cos(angle), radius * Math.sin(angle));
    pressures.push(0.5);
  }
  const { points: out } = smoothInkStroke(points, pressures);
  for (let i = 0; i < out.length; i += 2) {
    const r = Math.hypot(out[i]!, out[i + 1]!);
    assert.ok(Math.abs(r - radius) < 0.5, `point ${i / 2} left the circle: ${r}`);
  }
  assert.ok(out.length / 2 > (radius * Math.PI) / INK_SMOOTH_SPACING - 2);
});

test("a corner rounds by less than half a millimetre", () => {
  const points = [0, 0, 30, 0, 30, 30];
  const { points: out } = smoothInkStroke(points, [0.5, 0.5, 0.5]);
  let nearest = Infinity;
  for (let i = 0; i < out.length; i += 2) {
    nearest = Math.min(nearest, Math.hypot(out[i]! - 30, out[i + 1]!));
  }
  assert.ok(nearest > 0.5 && nearest < 5, `corner cut by ${nearest}`);
});
