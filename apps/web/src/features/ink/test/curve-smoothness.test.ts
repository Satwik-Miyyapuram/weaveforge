// A stroke is stored (and drawn live) after simplification at INK_PACK_TOLERANCE,
// so its samples sit up to a couple of millimetres apart. Each span is drawn as
// INK_SEGMENT_SUBDIVISIONS straight capsules; too few and a small letter loop
// shows visible facets. This pins how sharp the join between two capsules may be.
import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_PACK_TOLERANCE, packInkStroke } from "@weaveforge/core";
import {
  INK_INSTANCE_FLOATS,
  packStrokeInstances,
  strokeInstanceCount,
} from "../render/ink-renderer";

/** Largest turn, in degrees, between neighbouring drawn capsules. */
function sharpestJoin(points: readonly number[]): number {
  const n = points.length / 2;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = points[2 * i]!;
    y[i] = points[2 * i + 1]!;
  }
  const out = new Float32Array(INK_INSTANCE_FLOATS * strokeInstanceCount(n));
  const used = packStrokeInstances({ x, y, pressure: new Uint8Array(n), width: 3 }, out);
  let worst = 0;
  for (let base = INK_INSTANCE_FLOATS; base < used; base += INK_INSTANCE_FLOATS) {
    const prev = base - INK_INSTANCE_FLOATS;
    const a1 = Math.atan2(out[prev + 3]! - out[prev + 1]!, out[prev + 2]! - out[prev]!);
    const a2 = Math.atan2(out[base + 3]! - out[base + 1]!, out[base + 2]! - out[base]!);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    worst = Math.max(worst, (turn * 180) / Math.PI);
  }
  return worst;
}

/** One and a half turns of a circle, sampled about every 0.1 mm as a pen would. */
function loop(radius: number): number[] {
  const samples = Math.ceil(3 * Math.PI * radius);
  const points: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const a = (i / samples) * 3 * Math.PI;
    points.push(100.3 + radius * Math.cos(a), 100.7 + radius * Math.sin(a));
  }
  return points;
}

test("a small handwritten loop is drawn without visible facets", () => {
  // 0.8 mm to 4 mm radius: the bowls of letters at normal handwriting size.
  for (const radius of [8, 12, 20, 40]) {
    const packed = packInkStroke(loop(radius), [], { tolerance: INK_PACK_TOLERANCE });
    const worst = sharpestJoin(packed.points);
    assert.ok(worst <= 16, `radius ${radius / 10} mm: capsules join at ${worst.toFixed(1)}°`);
  }
});

test("a straight stroke stays straight however finely it is subdivided", () => {
  assert.ok(sharpestJoin([0, 0, 50, 0, 100, 0]) < 1e-3);
});
