import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree exactly on the ink geometry, so the TS copy can be
// deleted. Strokes are seeded so a failure reproduces from the seed.

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  points: number[];
  pressures: number[];
}

/** A wandering pen stroke in 0.1 mm, with repeats, jumps and pressure. */
function stroke(rand: () => number): Sample {
  const count = Math.floor(rand() * 60);
  const points: number[] = [];
  const pressures: number[] = [];
  let x = rand() * 2000;
  let y = rand() * 2000;
  let heading = rand() * Math.PI * 2;
  for (let i = 0; i < count; i += 1) {
    const kind = rand();
    if (kind < 0.08) {
      // Pen held still: a repeated sample.
    } else if (kind < 0.12) {
      x += (rand() - 0.5) * 400;
      y += (rand() - 0.5) * 400;
    } else {
      heading += (rand() - 0.5) * 0.8;
      const step = rand() * 12;
      x += Math.cos(heading) * step;
      y += Math.sin(heading) * step;
    }
    points.push(rand() < 0.5 ? Math.round(x) : x, rand() < 0.5 ? Math.round(y) : y);
    pressures.push(rand() < 0.1 ? 0 : rand() * 255);
  }
  return { points, pressures };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

/** `Object.is` per element, so NaN, -0 and the last bit all count. */
function same(a: readonly (number | null)[], b: readonly (number | null)[], label: string): void {
  assert.equal(a.length, b.length, `${label}: length`);
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(Object.is(a[i], b[i]), `${label}[${i}]: ts ${a[i]} rs ${b[i]}`);
  }
}

function xsYs(points: readonly number[]): [number[], number[]] {
  return [points.filter((_, i) => i % 2 === 0), points.filter((_, i) => i % 2 === 1)];
}

test("curve: tangents and span points match on seeded strokes", () => {
  for (const seed of SEEDS) {
    const [xs, ys] = xsYs(stroke(random(seed)).points);
    for (let i = 0; i < xs.length; i += 1) {
      for (const side of ["in", "out"] as const) {
        const a = ts.inkTangentAt(xs, ys, i, side);
        const b = rs.inkTangentAt(xs, ys, i, side);
        same([a.x, a.y], [b.x, b.y], `seed ${seed} tangent ${i} ${side}`);
      }
      if (i + 1 < xs.length) {
        for (const u of [0, 0.25, 0.5, 1 / 3, 0.9, 1]) {
          const a = ts.inkCurveAt(xs, ys, i, u);
          const b = rs.inkCurveAt(xs, ys, i, u);
          same([a.x, a.y], [b.x, b.y], `seed ${seed} curve ${i} ${u}`);
        }
      }
    }
  }
});

test("smooth: resample, binomial and smoothInkStroke match", () => {
  for (const seed of SEEDS) {
    const rand = random(seed);
    const s = stroke(rand);
    const spacing = [undefined, 1, 3, 7.5, 0, -1, Number.NaN][seed % 7];
    const ra = ts.resampleInkStroke(s.points, s.pressures, spacing);
    const rb = rs.resampleInkStroke(s.points, s.pressures, spacing);
    same(ra.points, rb.points, `seed ${seed} resample points`);
    same(ra.pressures, rb.pressures, `seed ${seed} resample pressures`);
    for (const stride of [1, 2]) {
      for (const passes of [0, 1, 2, 3]) {
        same(
          ts.binomialSmooth(s.points, stride, passes),
          rs.binomialSmooth(s.points, stride, passes),
          `seed ${seed} binomial ${stride}/${passes}`,
        );
      }
    }
    const options = [{}, { spacing: 2 }, { passes: 1 }, { spacing: 5, passes: 3 }][seed % 4]!;
    const sa = ts.smoothInkStroke(s.points, s.pressures, options);
    const sb = rs.smoothInkStroke(s.points, s.pressures, options);
    same(sa.points, sb.points, `seed ${seed} smooth points`);
    same(sa.pressures, sb.pressures, `seed ${seed} smooth pressures`);
  }
});

const ODD = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0, -3, 0.4, 1e9];

test("width: clamps, factors and nib widths match", () => {
  const rand = random(7);
  const values = [...ODD, ...Array.from({ length: 200 }, () => rand() * 300 - 20)];
  for (const v of values) {
    assert.ok(Object.is(ts.clampInkNoteWidth(v), rs.clampInkNoteWidth(v)), `clamp ${v}`);
    assert.ok(Object.is(ts.clampInkNoteWidth(v, 60), rs.clampInkNoteWidth(v, 60)), `clamp ${v} 60`);
    assert.ok(Object.is(ts.inkPressureFactor(v), rs.inkPressureFactor(v)), `pressure ${v}`);
    assert.ok(Object.is(ts.inkVelocityFactor(v / 30), rs.inkVelocityFactor(v / 30)), `velocity ${v}`);
    assert.ok(Object.is(ts.inkVelocityFactor(v / 30, 2), rs.inkVelocityFactor(v / 30, 2)), `velocity ${v} 2`);
    const p = rand() < 0.2 ? undefined : rand() * 255;
    const vel = rand() * 8;
    assert.ok(Object.is(ts.nibWidth(v, p, vel), rs.nibWidth(v, p, vel)), `nib ${v} ${p} ${vel}`);
    assert.ok(Object.is(ts.nibWidth(v, p), rs.nibWidth(v, p)), `nib ${v} ${p}`);
    assert.ok(
      Object.is(ts.nibWidth(v, p, vel, { fullTaper: 2 }), rs.nibWidth(v, p, vel, { fullTaper: 2 })),
      `nib ${v} taper`,
    );
  }
  assert.ok(Object.is(ts.inkPressureFactor(undefined), rs.inkPressureFactor(undefined)));
  for (const seed of SEEDS) {
    const r = random(seed);
    const args = [r() * 99, r() * 99, r() * 50, r() * 99, r() * 99, [r() * 50, 0, -1, Number.NaN][seed % 4]!] as const;
    assert.ok(Object.is(ts.inkVelocityBetween(...args), rs.inkVelocityBetween(...args)), `between ${args}`);
    const { pressures } = stroke(r);
    const base = [3, 60, 0, Number.NaN, 500][seed % 5]!;
    assert.ok(Object.is(ts.strokeBaseWidth(pressures, base), rs.strokeBaseWidth(pressures, base)), `base ${seed}`);
  }
});

test("zoom: clamp and steps match", () => {
  for (const z of [...ODD, 0.5, 0.6, 1, 1.25, 3.5, 4, 4.01, 2.2]) {
    assert.ok(Object.is(ts.clampInkZoom(z), rs.clampInkZoom(z)), `clamp ${z}`);
    assert.ok(Object.is(ts.inkZoomIn(z), rs.inkZoomIn(z)), `in ${z}`);
    assert.ok(Object.is(ts.inkZoomOut(z), rs.inkZoomOut(z)), `out ${z}`);
  }
});

const PACKER_OPTIONS: ts.InkStrokePackerOptions[] = [
  {},
  { tolerance: 0.5 },
  { tolerance: 4, pressureTolerance: 5 },
  { maxPoints: 10 },
  { maxPoints: 3 },
  { maxPoints: Number.NaN },
  { tolerance: 0 },
];

test("packer: packInkStroke matches, pressures of the wrong length included", () => {
  for (const seed of SEEDS) {
    const s = stroke(random(seed));
    const options = PACKER_OPTIONS[seed % PACKER_OPTIONS.length]!;
    const pressures = seed % 5 === 0 ? s.pressures.slice(1) : s.pressures;
    const points = seed % 11 === 0 ? [...s.points, 7] : s.points;
    const a = ts.packInkStroke(points, pressures, options);
    const b = rs.packInkStroke(points, pressures, options);
    same(a.points, b.points, `seed ${seed} points`);
    same(a.pressures, b.pressures, `seed ${seed} pressures`);
  }
  same(rs.packInkStroke([1, 2, Number.NaN, 4]).points, ts.packInkStroke([1, 2, Number.NaN, 4]).points, "NaN");
});

// Non-finite values, -0 and .5 ties, which seeded strokes never produce.
const EDGE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, -0.3, 2.5, -2.5, 0.49999999999999994];

test("edge values: curve, smooth and packer match on NaN, Infinity, -0 and ties", () => {
  const strokes: number[][] = [];
  for (const v of EDGE) {
    strokes.push([v, 1, 3, 4, 6, 2, 9, 9], [1, 2, v, v, 5, 7, 8, 1], [-0, -0, 3.5, -1.5, v, 0, 4, 4]);
  }
  for (const points of strokes) {
    const [xs, ys] = xsYs(points);
    for (let i = 0; i < xs.length; i += 1) {
      for (const side of ["in", "out"] as const) {
        const a = ts.inkTangentAt(xs, ys, i, side);
        const b = rs.inkTangentAt(xs, ys, i, side);
        same([a.x, a.y], [b.x, b.y], `${points} tangent ${i} ${side}`);
      }
      if (i + 1 < xs.length) {
        for (const u of [0, 0.5, 1]) {
          const a = ts.inkCurveAt(xs, ys, i, u);
          const b = rs.inkCurveAt(xs, ys, i, u);
          same([a.x, a.y], [b.x, b.y], `${points} curve ${i} ${u}`);
        }
      }
    }
    const pressures = points.slice(0, points.length / 2);
    // An infinite span never ends resampling, in TS and Rust alike.
    if (!points.some((v) => Math.abs(v) === Number.POSITIVE_INFINITY)) {
      const ra = ts.resampleInkStroke(points, pressures, 2);
      const rb = rs.resampleInkStroke(points, pressures, 2);
      same(ra.points, rb.points, `${points} resample points`);
      same(ra.pressures, rb.pressures, `${points} resample pressures`);
    }
    for (const passes of [0, 1, 1.5, -1, Number.NaN]) {
      same(ts.binomialSmooth(points, 2, passes), rs.binomialSmooth(points, 2, passes), `${points} binomial ${passes}`);
    }
    for (const options of [{}, { maxPoints: 3.5 }, { maxPoints: Number.POSITIVE_INFINITY }, { maxPoints: 2 }]) {
      const a = ts.packInkStroke(points, pressures, options);
      const b = rs.packInkStroke(points, pressures, options);
      same(a.points, b.points, `${points} pack ${JSON.stringify(options)} points`);
      same(a.pressures, b.pressures, `${points} pack ${JSON.stringify(options)} pressures`);
    }
  }
});

// The live packer stays in TS for now; packing each prefix in Rust must give
// what the live packer holds after that push.
test("packer: packInkStroke matches the live packer after every push", () => {
  for (const seed of SEEDS) {
    const s = stroke(random(seed));
    const options = PACKER_OPTIONS[seed % PACKER_OPTIONS.length]!;
    const withPressure = seed % 3 !== 0;
    const live = new ts.InkStrokePacker(options);
    for (let i = 0; i < s.points.length / 2; i += 1) {
      live.push(s.points[i * 2]!, s.points[i * 2 + 1]!, withPressure ? s.pressures[i] : undefined);
      if (i === 0) continue; // packInkStroke drops a lone point.
      const pa = live.packed();
      const pb = rs.packInkStroke(s.points.slice(0, i * 2 + 2), withPressure ? s.pressures.slice(0, i + 1) : [], options);
      same(pa.points, pb.points, `seed ${seed} push ${i} points`);
      same(pa.pressures, pb.pressures, `seed ${seed} push ${i} pressures`);
    }
  }
});
