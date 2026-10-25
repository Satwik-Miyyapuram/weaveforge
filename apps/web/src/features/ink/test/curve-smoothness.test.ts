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
  strokeCurveAt,
  strokeInstanceCount,
} from "../render/ink-renderer";

/**
 * How deep the deepest facet is, in 0.1 mm: at each join between two drawn
 * capsules, how far the join sits off the line through the capsules' far
 * ends. That is the corner the eye would see. The turn angle alone is not: a
 * 20° join between capsules a fortieth of a millimetre long is a facet two
 * thousandths of a millimetre deep, while 6° between quarter-millimetre
 * capsules is twelve.
 */
function deepestFacet(points: readonly number[]): number {
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
    const ax = out[prev]!;
    const ay = out[prev + 1]!;
    const bx = out[base]!;
    const by = out[base + 1]!;
    const cx = out[base + 2]!;
    const cy = out[base + 3]!;
    const length = Math.hypot(cx - ax, cy - ay);
    if (!(length > 0)) continue;
    worst = Math.max(worst, Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay)) / length);
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
  // A facet a fiftieth of a millimetre deep is a third of a pixel at 400%.
  for (const radius of [8, 12, 20, 40]) {
    const packed = packInkStroke(loop(radius), [], { tolerance: INK_PACK_TOLERANCE });
    const worst = deepestFacet(packed.points);
    assert.ok(worst <= 0.2, `radius ${radius / 10} mm: a facet ${worst.toFixed(3)} units deep`);
  }
});

test("a straight stroke stays straight however finely it is subdivided", () => {
  assert.ok(deepestFacet([0, 0, 50, 0, 100, 0]) < 1e-3);
});

type Path = (t: number) => readonly [number, number];

/** A cursive loop of radius `r`, travelling right as it turns, like an `l` or `e`. */
function cursive(r: number): Path {
  return (t) => [1000 + 0.4 * r * t + r * Math.sin(t), 1000 + 1.6 * r * Math.cos(t)];
}

/** Samples of `path` over `[0, end]` every `step` units of arc, as a pen reports them. */
function sample(path: Path, end: number, step: number): number[] {
  let [px, py] = path(0);
  const points = [px, py];
  let run = 0;
  for (let t = 0.0005; t <= end; t += 0.0005) {
    const [qx, qy] = path(t);
    run += Math.hypot(qx - px, qy - py);
    px = qx;
    py = qy;
    if (run >= step) {
      points.push(qx, qy);
      run = 0;
    }
  }
  return points;
}

/**
 * Largest angle, in degrees, between the drawn curve's direction and the pen's
 * at the nearest point of the pen's path. A span drawn as a straight chord
 * across a bend shows here as half the bend.
 */
function worstDirection(points: readonly number[], path: Path, end: number): number {
  const n = points.length / 2;
  const stroke = {
    x: Float32Array.from({ length: n }, (_, i) => points[2 * i]!),
    y: Float32Array.from({ length: n }, (_, i) => points[2 * i + 1]!),
    pressure: new Uint8Array(n),
    width: 3,
  };
  const truth: [number, number, number][] = [];
  for (let t = 0; t <= end; t += 0.002) {
    const [ax, ay] = path(t);
    const [bx, by] = path(t + 1e-4);
    truth.push([ax, ay, Math.atan2(by - ay, bx - ax)]);
  }
  const steps = 16;
  let worst = 0;
  let cursor = 0;
  for (let i = 0; i + 1 < n; i += 1) {
    for (let k = 0; k < steps; k += 1) {
      const p = strokeCurveAt(stroke, i, k / steps);
      const q = strokeCurveAt(stroke, i, (k + 1) / steps);
      if (Math.hypot(q.x - p.x, q.y - p.y) < 0.05) continue;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      // Nearest point, searched forward from the last one so a loop's crossing
      // does not match the other branch.
      let best = Infinity;
      let at = cursor;
      for (let j = Math.max(0, cursor - 50); j < Math.min(truth.length, cursor + 400); j += 1) {
        const d = Math.hypot(truth[j]![0] - mx, truth[j]![1] - my);
        if (d < best) {
          best = d;
          at = j;
        }
      }
      cursor = at;
      let off = Math.abs(Math.atan2(q.y - p.y, q.x - p.x) - truth[at]![2]);
      if (off > Math.PI) off = 2 * Math.PI - off;
      worst = Math.max(worst, (off * 180) / Math.PI);
    }
  }
  return worst;
}

test("a small cursive loop written at speed follows the pen, not chords", () => {
  // Pen samples at 240 Hz. At 50-150 mm/s a 0.5-2 mm loop leaves samples
  // 60-110 degrees apart round its tight end. A tangent that fades on that
  // turn draws the end as straight chords (64 degrees off the pen at 0.5 mm,
  // 50 mm/s); Catmull-Rom's tangent bends through it (worst 36 degrees here).
  for (const [radius, speed] of [
    [5, 50],
    [8, 50],
    [8, 150],
    [12, 50],
    [12, 150],
    [20, 50],
    [20, 150],
  ] as const) {
    const path = cursive(radius);
    const end = 4 * Math.PI;
    // speed mm/s over 240 Hz is mm per sample; the model's unit is 0.1 mm.
    const raw = sample(path, end, (speed / 240) * 10);
    const packed = packInkStroke(raw, [], { tolerance: INK_PACK_TOLERANCE });
    const worst = worstDirection(packed.points, path, end);
    assert.ok(
      worst <= 40,
      `${radius / 10} mm loop at ${speed} mm/s: drawn ${worst.toFixed(0)} degrees off the pen`,
    );
  }
});
