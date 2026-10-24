// packStrokeInstances evaluates each curve point once and reuses it as the next
// instance's end. This pins its output to the plain one-call-per-use loop.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_INSTANCE_FLOATS,
  INK_SEGMENT_SUBDIVISIONS,
  packStrokeInstances,
  strokeCurveAt,
  strokeInstanceCount,
} from "../render/ink-renderer";

type Stroke = Parameters<typeof packStrokeInstances>[0];

function reference(stroke: Stroke, out: Float32Array, from: number): number {
  const segments = Math.max(0, Math.min(stroke.x.length, stroke.y.length) - 1);
  const last = INK_SEGMENT_SUBDIVISIONS;
  const at = (i: number, k: number) => strokeCurveAt(stroke, i, k / last);
  let cursor = 0;
  let prev = from > 0 ? at(from - 1, last - 1) : null;
  for (let i = from; i < segments; i += 1) {
    let a = at(i, 0);
    for (let k = 1; k <= last; k += 1) {
      const b = at(i, k);
      const next = k < last ? at(i, k + 1) : i + 1 < segments ? at(i + 1, 1) : null;
      out.set(
        [a.x, a.y, b.x, b.y, a.r, b.r, prev ? prev.x : 0, prev ? prev.y : 0,
          next ? next.x : 0, next ? next.y : 0, prev ? prev.r : -1, next ? next.r : -1],
        cursor * INK_INSTANCE_FLOATS,
      );
      cursor += 1;
      prev = a;
      a = b;
    }
  }
  return cursor * INK_INSTANCE_FLOATS;
}

function curvy(points: number): Stroke {
  return {
    x: Float32Array.from({ length: points }, (_u, i) => i * 13 + Math.sin(i) * 7),
    y: Float32Array.from({ length: points }, (_u, i) => Math.cos(i * 1.3) * 20),
    pressure: Uint8Array.from({ length: points }, () => 200),
    width: 6,
  };
}

for (const points of [0, 1, 2, 3, 9]) {
  for (const from of [0, 1, Math.max(0, points - 2)]) {
    test(`matches the reference for ${points} points from segment ${from}`, () => {
      const stroke = curvy(points);
      const size = INK_INSTANCE_FLOATS * Math.max(1, strokeInstanceCount(points));
      const got = new Float32Array(size);
      const want = new Float32Array(size);
      assert.equal(packStrokeInstances(stroke, got, { from }), reference(stroke, want, from));
      assert.deepEqual(got, want);
    });
  }
}
