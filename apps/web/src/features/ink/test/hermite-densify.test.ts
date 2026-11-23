// Strokes saved before 0.9.5 were packed at INK_PACK_TOLERANCE: only the
// samples that keep the Hermite curve (curve.rs) on the pen were stored, a
// millimetre or two apart round a loop. 0.9.4 drew that curve; the freehand
// renderer joins its points with straight lines, so it must be fed the curve.
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { INK_PACK_TOLERANCE } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { freedrawPath, getFreeDrawSvgPath, INK_FREEDRAW, type FreedrawElement } from "../render/excalidraw-freedraw";
import { CORNER_DEGREES, smoothKeepingCorners, turnDegrees } from "../render/corner-smoothing";
import { densifyHermite, HERMITE_MAX_PIECES, HERMITE_MIN_SPAN, HERMITE_STEP } from "../render/hermite-densify";

before(loadTestCore);

const CX = 100.3;
const CY = 100.7;

/** One and a half turns of a circle about (CX, CY), sampled every 0.1 mm as a pen would. */
function loop(radius: number): number[] {
  const samples = Math.ceil(3 * Math.PI * radius);
  const points: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const a = (i / samples) * 3 * Math.PI;
    points.push(CX + radius * Math.cos(a), CY + radius * Math.sin(a));
  }
  return points;
}

function split(flat: readonly number[]): { x: number[]; y: number[] } {
  return { x: flat.filter((_, i) => i % 2 === 0), y: flat.filter((_, i) => i % 2 === 1) };
}

function packed(raw: readonly number[]): { x: number[]; y: number[] } {
  return split(typedCore().packInkStroke([...raw], [], { tolerance: INK_PACK_TOLERANCE }).points);
}

/**
 * The sharpest bend of the outline, in degrees, away from the round caps at
 * `ends`. Pieces shorter than half a unit are merged: the path is written to two
 * decimals, and a hundredth-long piece has any direction. A chord between two
 * stored points leaves a kink here; a curve does not.
 */
function sharpestBend(d: string, ends: readonly (readonly [number, number])[]): number {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const p: [number, number] = [nums[i]!, nums[i + 1]!];
    const q = pts.at(-1);
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 0.5) pts.push(p);
  }
  let worst = 0;
  for (let i = 1; i + 1 < pts.length; i += 1) {
    const [px, py] = pts[i]!;
    if (ends.some(([ex, ey]) => Math.hypot(px - ex, py - ey) < 5)) continue;
    const a = Math.atan2(py - pts[i - 1]![1], px - pts[i - 1]![0]);
    const b = Math.atan2(pts[i + 1]![1] - py, pts[i + 1]![0] - px);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    worst = Math.max(worst, (turn * 180) / Math.PI);
  }
  return worst;
}

test("an old packed loop draws round, as the raw pen samples do, not as chords", () => {
  for (const radius of [8, 12, 20, 40, 80]) {
    const raw = split(loop(radius));
    const old = packed(loop(radius));
    assert.ok(old.x.length * 3 < raw.x.length, `radius ${radius}: the packer kept ${old.x.length} of ${raw.x.length}`);
    const ends = [[old.x[0]!, old.y[0]!], [old.x.at(-1)!, old.y.at(-1)!]] as const;
    const drawnRaw = sharpestBend(freedrawPath(raw.x, raw.y, 3, true), ends);
    const drawnOld = sharpestBend(freedrawPath(old.x, old.y, 3, true), ends);
    // The stored points sit on a 0.1 mm grid, so the curve through them wobbles
    // a little more than the pen did; a chord kinks by the whole span's turn.
    assert.ok(
      drawnOld <= drawnRaw + 15,
      `radius ${radius / 10} mm: packed bends ${drawnOld.toFixed(1)} deg vs raw ${drawnRaw.toFixed(1)} deg`,
    );
  }
});
test("the filled points lie on the stored Hermite curve and every stored point is kept", () => {
  const old = packed(loop(12));
  const x = Float32Array.from(old.x);
  const y = Float32Array.from(old.y);
  const points = Array.from(x, (v, i) => [v, y[i]!]);
  const dense = densifyHermite(points, points.map(() => 0.5));
  let at = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    assert.deepEqual(dense.points[at], points[i]);
    const length = Math.hypot(x[i + 1]! - x[i]!, y[i + 1]! - y[i]!);
    const pieces = length > HERMITE_MIN_SPAN ? Math.min(HERMITE_MAX_PIECES, Math.ceil(length / HERMITE_STEP)) : 1;
    for (let k = 1; k < pieces; k += 1) {
      const want = typedCore().inkCurveAt(x, y, i, k / pieces);
      const got = dense.points[at + k]!;
      assert.ok(Math.hypot(got[0]! - want.x, got[1]! - want.y) < 1e-3, `span ${i}, piece ${k}`);
    }
    at += Math.max(1, pieces);
  }
  assert.deepEqual(dense.points.at(-1), points.at(-1));
  assert.equal(at, dense.points.length - 1);
});

test("a raw stroke, samples closer than the minimum span, draws exactly as before", () => {
  const raw = split(loop(20));
  const points = raw.x.map((v, i) => [v, raw.y[i]!]);
  const pressures = points.map(() => 0.5);
  assert.deepEqual(densifyHermite(points, pressures), { points, pressures, corners: points.map(() => false) });
  const drawn = Math.max(0, 3) * INK_FREEDRAW.widthRatio;
  const before = getFreeDrawSvgPath(
    { points: smoothKeepingCorners(points), pressures, strokeWidth: 0, simulatePressure: true, lastCommittedPoint: [0, 0] } as FreedrawElement,
    { thinning: INK_FREEDRAW.mouse.thinning, smoothing: INK_FREEDRAW.pen.smoothing, streamline: INK_FREEDRAW.pen.streamline, size: drawn },
  );
  assert.equal(freedrawPath(raw.x, raw.y, 3, true), before);
});

test("one point and two points", () => {
  assert.deepEqual(densifyHermite([[5, 5]], [0.3]), { points: [[5, 5]], pressures: [0.3], corners: [false] });
  assert.deepEqual(densifyHermite([], []), { points: [], pressures: [], corners: [] });
  // Two points: the end tangents are the chord, so the curve is the straight line.
  const two = densifyHermite([[0, 0], [10, 0]], [0, 1]);
  assert.equal(two.points.length, 11);
  two.points.forEach(([px, py], k) => {
    assert.ok(Math.abs(px! - k) < 1e-9 && py === 0, `point ${k}: ${px}, ${py}`);
    assert.ok(Math.abs(two.pressures[k]! - k / 10) < 1e-9);
  });
  // Two samples on top of each other: no tangent, nothing added.
  assert.deepEqual(densifyHermite([[1, 1], [1, 1]], [0.5, 0.5]).points, [[1, 1], [1, 1]]);
  for (const [xs, ys] of [[[5], [5]], [[0, 10], [0, 0]]]) {
    assert.doesNotMatch(freedrawPath(xs!, ys!, 3, true), /NaN|Infinity/);
    assert.doesNotMatch(freedrawPath(xs!, ys!, 3, true, xs!.map(() => 200)), /NaN|Infinity/);
  }
});

test("filling costs at most one point per step of length, and a bounded count per span", () => {
  const old = packed(loop(40));
  const points = old.x.map((v, i) => [v, old.y[i]!]);
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i]![0]! - points[i - 1]![0]!, points[i]![1]! - points[i - 1]![1]!);
  const dense = densifyHermite(points, points.map(() => 0.5));
  assert.ok(dense.points.length <= points.length + Math.ceil(length / HERMITE_STEP));
  assert.equal(dense.pressures.length, dense.points.length);
  // A broken stroke with a huge jump stays cheap.
  const jump = densifyHermite([[0, 0], [1e7, 0], [1e7, 1]], [0.5, 0.5, 0.5]);
  assert.ok(jump.points.length <= 1 + 2 * HERMITE_MAX_PIECES);
  // A pen-rate stroke (samples no further apart than the minimum span) gains nothing.
  const pen = Array.from({ length: 100 }, (_, i) => [i * HERMITE_MIN_SPAN, 0]);
  assert.equal(densifyHermite(pen, pen.map(() => 0.5)).points.length, 100);
  // A long stroke of 10 000 points fills in well under a frame's budget per call.
  const long = Array.from({ length: 10_000 }, (_, i) => [i * 3, Math.sin(i / 5) * 20]);
  const start = performance.now();
  const filled = densifyHermite(long, long.map(() => 0.5));
  const ms = performance.now() - start;
  assert.ok(filled.points.length <= long.length * HERMITE_MAX_PIECES);
  assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
});

/** A pen polyline through `corners`, sampled every `spacing` (0.1 mm by default). */
function polyline(corners: readonly (readonly [number, number])[], spacing = 1): number[] {
  const out: number[] = [corners[0]![0], corners[0]![1]];
  for (let c = 1; c < corners.length; c += 1) {
    const [ax, ay] = corners[c - 1]!;
    const [bx, by] = corners[c]!;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / spacing);
    for (let s = 1; s <= steps; s += 1) out.push(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
  }
  return out;
}

/** Distance from `p` to the polyline through `corners`. */
function offPolyline(p: readonly number[], corners: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let c = 1; c < corners.length; c += 1) {
    const [ax, ay] = corners[c - 1]!;
    const [bx, by] = corners[c]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0]! - ax) * dx + (p[1]! - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0]! - (ax + t * dx), p[1]! - (ay + t * dy)));
  }
  return best;
}

const LETTERS: Record<string, readonly (readonly [number, number])[]> = {
  N: [[10, 110], [10, 10], [70, 110], [70, 10]],
  z: [[10, 10], [70, 10], [10, 70], [70, 70]],
  M: [[10, 110], [10, 10], [45, 70], [80, 10], [80, 110]],
};

test("an old packed N, z and M, and a fast raw one, keep their corners sharp", () => {
  const strokes = Object.entries(LETTERS).flatMap(([name, corners]) => [
    { name: `packed ${name}`, corners, old: packed(polyline(corners)) },
    // A fast pen: 1.2 mm between samples, a sample on each corner.
    { name: `fast ${name}`, corners, old: split(polyline(corners, 12)) },
  ]);
  for (const { name, corners, old } of strokes) {
    const points = old.x.map((v, i) => [v, old.y[i]!]);
    const dense = densifyHermite(points, points.map(() => 0.5));
    const worst = Math.max(...dense.points.map((p) => offPolyline(p, corners)));
    assert.ok(worst < 0.5, `${name}: filled points stray ${worst.toFixed(2)} from the drawn lines`);
    // The smoothing after the fill must still see each corner and leave it in place.
    const smooth = smoothKeepingCorners(dense.points, dense.corners);
    for (const [cx, cy] of corners) {
      const near = Math.min(...smooth.map((p) => Math.hypot(p[0]! - cx, p[1]! - cy)));
      assert.ok(near < 0.05, `${name}: corner ${cx},${cy} rounded off by ${near.toFixed(2)}`);
    }
    // And the outline drawn is the one built from those points.
    const drawn = Math.max(0, 3) * INK_FREEDRAW.widthRatio;
    const want = getFreeDrawSvgPath(
      { points: smooth, pressures: dense.pressures, strokeWidth: 0, simulatePressure: true, lastCommittedPoint: [0, 0] } as FreedrawElement,
      { thinning: INK_FREEDRAW.mouse.thinning, smoothing: INK_FREEDRAW.pen.smoothing, streamline: INK_FREEDRAW.pen.streamline, size: drawn },
    );
    assert.equal(freedrawPath(old.x, old.y, 3, true), want, name);
  }
});

test("a sparse Z, M and W, every vertex sharp and side by side, keep their corners", () => {
  const sparse: Record<string, readonly (readonly [number, number])[]> = {
    Z: [[10, 10], [70, 10], [10, 70], [70, 70]],
    M: LETTERS.M!,
    W: [[10, 10], [30, 110], [50, 40], [70, 110], [90, 10]],
  };
  for (const [name, corners] of Object.entries(sparse)) {
    const points = corners.map(([x, y]) => [x, y]);
    const dense = densifyHermite(points, points.map(() => 0.5));
    assert.deepEqual(dense.corners.filter((c) => c).length, corners.length - 2, `${name}: corners flagged`);
    const worst = Math.max(...dense.points.map((p) => offPolyline(p, corners)));
    assert.ok(worst < 0.5, `${name}: filled points stray ${worst.toFixed(2)} from the drawn lines`);
  }
});

test("dense jitter is smoothed, not pinned: no spike survives", () => {
  // A pen-rate stroke shaking ±0.5 every sample: each sample turns 90 degrees.
  const points = Array.from({ length: 60 }, (_, i) => [i, i % 2 ? 0.5 : -0.5]);
  assert.ok(points.slice(1, -1).every((q, i) => turnDegrees(points[i]!, q, points[i + 2]!) > CORNER_DEGREES));
  const dense = densifyHermite(points, points.map(() => 0.5));
  assert.ok(dense.corners.every((c) => !c), "a shake on short spans was read as corners");
  const smooth = smoothKeepingCorners(dense.points, dense.corners);
  // The ends are held, so the shake fades in over a few samples there.
  const spike = Math.max(...smooth.slice(6, -6).map((p) => Math.abs(p[1]!)));
  assert.ok(spike < 0.2, `a ${spike.toFixed(2)} spike survived the smoothing`);
});

test("the fill matches curve.rs except at corners, where it follows the chords", () => {
  // Pins the one difference from wf-core's ink_tangent_at until curve.rs takes
  // the corner rule too (0.9.8).
  const corners = LETTERS.N!;
  const old = split(polyline(corners, 12));
  const x = Float32Array.from(old.x);
  const y = Float32Array.from(old.y);
  const points = Array.from(x, (v, i) => [v, y[i]!]);
  const dense = densifyHermite(points, points.map(() => 0.5));
  const isCorner = points.map((_, i) => dense.corners[dense.points.indexOf(points[i]!)]!);
  let at = 0;
  let worstAway = 0;
  let mostAtCorner = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const length = Math.hypot(x[i + 1]! - x[i]!, y[i + 1]! - y[i]!);
    const pieces = length > HERMITE_MIN_SPAN ? Math.min(HERMITE_MAX_PIECES, Math.ceil(length / HERMITE_STEP)) : 1;
    for (let k = 1; k < pieces; k += 1) {
      const want = typedCore().inkCurveAt(x, y, i, k / pieces);
      const got = dense.points[at + k]!;
      const off = Math.hypot(got[0]! - want.x, got[1]! - want.y);
      if (isCorner[i] || isCorner[i + 1]) mostAtCorner = Math.max(mostAtCorner, off);
      else worstAway = Math.max(worstAway, off);
    }
    at += Math.max(1, pieces);
  }
  assert.ok(worstAway < 1e-3, `away from corners the fill left curve.rs by ${worstAway}`);
  assert.ok(mostAtCorner > 0.5, `at corners the fill should follow the chords, not curve.rs (${mostAtCorner.toFixed(2)})`);
});
