import { test } from "node:test";
import assert from "node:assert/strict";

import { INK_PACK_TOLERANCE, InkStrokePacker, inkCurveAt, packInkStroke } from "../../src/index.js";

// Strokes in the model's unit, 0.1 mm. A pen reports at 240 Hz, so a stroke
// written at v mm/s leaves a sample every (v / 240) * 10 units.
const stepAt = (speed: number) => (speed / 240) * 10;

/** A rectangle traced corner to corner, `wobble` units of hand shake on it. */
function box(w: number, h: number, step: number, wobble: number): number[] {
  const corners = [[100, 500], [100 + w, 500], [100 + w, 500 + h], [100, 500 + h], [100, 500]];
  const points: number[] = [];
  for (let e = 0; e < 4; e += 1) {
    const [ax, ay] = corners[e]!;
    const [bx, by] = corners[e + 1]!;
    const length = Math.hypot(bx! - ax!, by! - ay!);
    const n = Math.max(1, Math.round(length / step));
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      const s = e * length + k * step;
      points.push(ax! + (bx! - ax!) * t + wobble * Math.sin(0.07 * s + e), ay! + (by! - ay!) * t + wobble * Math.cos(0.05 * s + 2 * e));
    }
  }
  points.push(100, 500);
  return points;
}

/** Cursive loops of radius `r` drifting right, sampled every `step` units of arc. */
function loops(r: number, step: number, turns = 2): number[] {
  const at = (t: number) => [1000 + 0.4 * r * t + r * Math.sin(t), 1000 + 1.6 * r * Math.cos(t)] as const;
  let [px, py] = at(0);
  const points = [px, py];
  let run = 0;
  for (let t = 0.0005; t <= turns * 2 * Math.PI; t += 0.0005) {
    const [qx, qy] = at(t);
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

/** Distance from a point to the drawn curve of one span, the span cut into 32 chords. */
function spanDistance(xs: Float64Array, ys: Float64Array, span: number, px: number, py: number): number {
  let best = Infinity;
  let a = inkCurveAt(xs, ys, span, 0);
  for (let k = 1; k <= 32; k += 1) {
    const b = inkCurveAt(xs, ys, span, k / 32);
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const length = vx * vx + vy * vy;
    const u = length > 0 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / length)) : 0;
    best = Math.min(best, Math.hypot(a.x + u * vx - px, a.y + u * vy - py));
    a = b;
  }
  return best;
}

/**
 * How far the curve drawn through `packed` strays from the pen's samples: each
 * rounded sample, against the span it fell in. Packed points are a subset of
 * the rounded samples in order, which is what lets a sample find its span.
 */
function worstSampleDistance(raw: readonly number[], packed: readonly number[]): number {
  const rounded = raw.map(Math.round);
  const n = packed.length / 2;
  const xs = Float64Array.from({ length: n }, (_, i) => packed[2 * i]!);
  const ys = Float64Array.from({ length: n }, (_, i) => packed[2 * i + 1]!);
  let worst = 0;
  let span = 0;
  for (let j = 1; j < rounded.length / 2; j += 1) {
    const x = rounded[2 * j]!;
    const y = rounded[2 * j + 1]!;
    if (span + 1 < n - 1 && x === xs[span + 1] && y === ys[span + 1]) {
      span += 1;
      continue;
    }
    worst = Math.max(worst, spanDistance(xs, ys, span, x, y));
  }
  return worst;
}

test("the curve drawn through a packed stroke stays within the pack tolerance of every sample", () => {
  const cases: [string, number[]][] = [];
  for (const [w, h] of [[200, 150], [50, 30], [20, 20]] as const)
    for (const speed of [50, 150, 300])
      for (const wobble of [0, 1, 3]) cases.push([`box ${w}x${h} ${speed}mm/s wobble ${wobble}`, box(w, h, stepAt(speed), wobble)]);
  for (const [r, speed] of [[5, 50], [12, 150], [50, 50], [100, 50]] as const)
    cases.push([`loops r${r} ${speed}mm/s`, loops(r, stepAt(speed))]);
  for (const [name, raw] of cases) {
    const packed = packInkStroke(raw).points;
    const worst = worstSampleDistance(raw, packed);
    // The bound is checked against 32 chords a span, so allow their sagitta.
    assert.ok(worst <= INK_PACK_TOLERANCE + 0.05, `${name}: a sample is ${worst.toFixed(2)} units off the curve`);
  }
});

test("a clean box is drawn as a box: its edges do not bow out past the tolerance", () => {
  // The pass bounds the curve at the samples. Between two samples at a corner
  // the curve still rounds the turn, and with the pen's samples 1.25 mm apart
  // (300 mm/s) that measured 1.46 units past the edge with every sample kept.
  // Twice the tolerance, 0.24 mm, is that with room; the 3 mm bow of a box
  // kept as its corners is what this guards.
  const bound = 2 * INK_PACK_TOLERANCE;
  for (const [w, h, speed] of [[200, 150, 50], [200, 150, 150], [200, 150, 300], [50, 30, 150], [50, 30, 300], [20, 20, 150], [20, 20, 300]] as const) {
    const packed = packInkStroke(box(w, h, stepAt(speed), 0)).points;
    const n = packed.length / 2;
    const xs = Float64Array.from({ length: n }, (_, i) => packed[2 * i]!);
    const ys = Float64Array.from({ length: n }, (_, i) => packed[2 * i + 1]!);
    let out = 0;
    for (let i = 0; i + 1 < n; i += 1)
      for (let k = 0; k <= 64; k += 1) {
        const p = inkCurveAt(xs, ys, i, k / 64);
        out = Math.max(out, 100 - p.x, p.x - (100 + w), 500 - p.y, p.y - (500 + h));
      }
    assert.ok(out <= bound, `${w}x${h} at ${speed} mm/s: the curve bows ${out.toFixed(2)} units past an edge`);
  }
});

/** A press that swells and fades along the stroke, the way a written word does. */
function taper(n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(120 + 100 * Math.sin((i / n) * Math.PI * 3)));
}

/** Each frame of a stroke as the pen writes it: what the packer holds after every sample. */
function frames(raw: readonly number[], pressures: readonly number[] = []) {
  const packer = new InkStrokePacker();
  const out: { points: number[]; pressures: number[] }[] = [];
  for (let i = 0; i < raw.length / 2; i += 1) {
    packer.push(raw[2 * i]!, raw[2 * i + 1]!, pressures[i]);
    out.push(packer.packed());
  }
  return out;
}

const written: [string, number[]][] = [
  ["loops r5 50mm/s", loops(5, stepAt(50))],
  ["loops r8 150mm/s", loops(8, stepAt(150))],
  ["loops r12 20mm/s", loops(12, stepAt(20), 5)],
  ["box 50x30 300mm/s wobble 1", box(50, 30, stepAt(300), 1)],
  ["box 200x150 50mm/s wobble 3", box(200, 150, stepAt(50), 3)],
];

test("packing as the pen writes gives the same stroke as packing it whole", () => {
  for (const [name, raw] of written) {
    const pressures = taper(raw.length / 2);
    assert.deepEqual(frames(raw, pressures).at(-1), packInkStroke(raw, pressures), name);
    assert.deepEqual(frames(raw).at(-1), packInkStroke(raw), `${name}, no pressure`);
  }
});

test("a point once kept never moves: every frame extends the one before", () => {
  // Only the pen's own sample, the last point, is replaced by the next frame.
  for (const [name, raw] of written) {
    const all = frames(raw, taper(raw.length / 2));
    for (let k = 1; k < all.length; k += 1) {
      const before = all[k - 1]!;
      const after = all[k]!;
      assert.deepEqual(after.points.slice(0, before.points.length - 2), before.points.slice(0, -2), `${name}, frame ${k}`);
      assert.deepEqual(after.pressures.slice(0, before.pressures.length - 1), before.pressures.slice(0, -1), `${name}, frame ${k}`);
    }
  }
});

test("ink behind the pen is drawn the same in every later frame", () => {
  // A span's curve reads the point after its end, so the last two spans may
  // still turn; everything before them is final the moment it is drawn.
  const curveOf = (points: readonly number[], spans: number) => {
    const n = points.length / 2;
    const xs = Float64Array.from({ length: n }, (_, i) => points[2 * i]!);
    const ys = Float64Array.from({ length: n }, (_, i) => points[2 * i + 1]!);
    const out: number[] = [];
    for (let s = 0; s < spans; s += 1)
      for (let k = 0; k <= 8; k += 1) {
        const p = inkCurveAt(xs, ys, s, k / 8);
        out.push(p.x, p.y);
      }
    return out;
  };
  for (const [name, raw] of written) {
    const all = frames(raw);
    const last = all.at(-1)!.points;
    for (const [k, frame] of all.entries()) {
      const settled = frame.points.length / 2 - 3;
      if (settled > 0) assert.deepEqual(curveOf(frame.points, settled), curveOf(last, settled), `${name}, frame ${k}`);
    }
  }
});

test("a pen held still or tapped packs to finite points", () => {
  assert.deepEqual(packInkStroke([50, 60, 50, 60]).points, [50, 60, 50, 60], "a tap is a dot");
  const still: number[] = [];
  for (let i = 0; i < 30; i += 1) still.push(200, 200);
  for (let i = 0; i < 30; i += 1) still.push(200 + i * 4, 200 + (i % 3));
  const packed = packInkStroke(still, taper(still.length / 2));
  assert.ok(packed.points.length >= 4);
  for (const value of packed.points) assert.ok(Number.isFinite(value));
  assert.deepEqual(packed.points.slice(-2), still.slice(-2));
});

test("a stroke shorter than two samples packs to nothing, one sample to itself", () => {
  const packer = new InkStrokePacker();
  assert.deepEqual(packer.packed(), { points: [], pressures: [] });
  packer.push(10.4, 20.6, 300);
  assert.deepEqual(packer.packed(), { points: [10, 21], pressures: [255] });
});

test("a sample that is not a number is skipped, so the stroke stays drawable", () => {
  const packer = new InkStrokePacker();
  packer.push(0, 0, 128);
  packer.push(Number.NaN, 5, 128);
  packer.push(30, Number.POSITIVE_INFINITY, 128);
  packer.push(30, 0, 128);
  assert.deepEqual(packer.packed(), { points: [0, 0, 30, 0], pressures: [128, 128] });
});

test("a straight line is still its two ends", () => {
  const raw: number[] = [];
  for (let i = 0; i <= 100; i += 1) raw.push(10 + i * 3, 40);
  assert.deepEqual(packInkStroke(raw).points, [10, 40, 310, 40]);
});

test("the curve pass never pushes a stroke past the point cap", () => {
  // A wobbly box drawn round and round: every corner wants points back.
  const raw: number[] = [];
  for (let lap = 0; lap < 60; lap += 1) raw.push(...box(200, 150, stepAt(50), 1));
  const packed = packInkStroke(raw, [], { maxPoints: 200 });
  assert.ok(packed.points.length / 2 <= 200, `${packed.points.length / 2} points`);
  assert.deepEqual(packed.points.slice(-2), raw.slice(-2).map(Math.round), "and the true end is kept");
});

test("packed points are always samples of the stroke, in order", () => {
  const raw = box(50, 30, stepAt(150), 1);
  const rounded = raw.map(Math.round);
  const packed = packInkStroke(raw).points;
  let j = 0;
  for (let i = 0; i < packed.length / 2; i += 1) {
    while (j < rounded.length / 2 && (rounded[2 * j] !== packed[2 * i] || rounded[2 * j + 1] !== packed[2 * i + 1])) j += 1;
    assert.ok(j < rounded.length / 2, `point ${i} is a sample`);
    j += 1;
  }
});
