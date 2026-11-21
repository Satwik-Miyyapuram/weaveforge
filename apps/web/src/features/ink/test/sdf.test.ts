/**
 * The Hermite curve a stroke is drawn as (the core's `inkCurveAt` and
 * `inkTangentAt`, which the SVG path samples), and the canvas backing ratio.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { INK_PACK_TOLERANCE } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import {
  INK_MAX_BACKING_DIMENSION,
  INK_MAX_BACKING_PIXELS,
  backingRatio,
} from "../render/parts-1";

before(loadTestCore);

interface Samples {
  x: Float32Array;
  y: Float32Array;
}
const strokeCurveAt = (stroke: Samples, i: number, u: number) =>
  typedCore().inkCurveAt(stroke.x, stroke.y, i, u);
const strokeTangentAt = (stroke: Samples, i: number) =>
  typedCore().inkTangentAt(stroke.x, stroke.y, i, "out");

test("the spline follows an arc the polyline would cut", () => {
  // Four samples on a circle: halfway along the middle segment the chord sits
  // 1.5 % inside the circle, and the spline within 0.1 % of it.
  const radius = 100;
  const angles = [0, 20, 40, 60].map((degrees) => (degrees * Math.PI) / 180);
  const stroke = {
    x: Float32Array.from(angles.map((a) => radius * Math.cos(a))),
    y: Float32Array.from(angles.map((a) => radius * Math.sin(a))),
    pressure: Uint8Array.from([0, 0, 0, 0]),
    width: 6,
  };
  const mid = strokeCurveAt(stroke, 1, 0.5);
  const chord = radius * Math.cos((10 * Math.PI) / 180);
  const along = Math.hypot(mid.x, mid.y);
  assert.ok(along > chord, `outside the chord: ${along} > ${chord}`);
  assert.ok(Math.abs(along - radius) < 0.1 * radius * 0.01);
  const start = strokeCurveAt(stroke, 1, 0);
  assert.ok(Math.abs(start.x - stroke.x[1]!) < 1e-9, "and passes through the samples");
});

test("a packed box is drawn as a box, with nothing visible past it", () => {
  // A box traced at 150 mm/s (a sample every 0.6 mm) and packed as a stroke is
  // saved. Kept as only its corners, the unfaded curve would bow 3 mm past the
  // edges; packing puts samples back until the curve is within its tolerance
  // of every one, so what is left is the corner's own rounding between two
  // samples, measured under 1.5 units. Twice the tolerance, 0.24 mm, allows it.
  const raw: number[] = [];
  const corners = [[100, 500], [300, 500], [300, 650], [100, 650], [100, 500]];
  for (let e = 0; e < 4; e += 1) {
    const [ax, ay] = corners[e]!;
    const [bx, by] = corners[e + 1]!;
    const n = Math.round(Math.hypot(bx! - ax!, by! - ay!) / 6.25);
    for (let k = 0; k < n; k += 1) raw.push(ax! + ((bx! - ax!) * k) / n, ay! + ((by! - ay!) * k) / n);
  }
  raw.push(100, 500);
  const packed = typedCore().packInkStroke(raw).points;
  const stroke = {
    x: Float32Array.from(packed.filter((_, i) => i % 2 === 0)),
    y: Float32Array.from(packed.filter((_, i) => i % 2 === 1)),
    pressure: new Uint8Array(packed.length / 2).fill(128),
    width: 6,
  };
  const slack = 2 * INK_PACK_TOLERANCE;
  for (let i = 0; i + 1 < stroke.x.length; i += 1) {
    for (let k = 0; k <= 32; k += 1) {
      const p = strokeCurveAt(stroke, i, k / 32);
      assert.ok(p.x >= 100 - slack && p.x <= 300 + slack, `x inside: ${p.x}`);
      assert.ok(p.y >= 500 - slack && p.y <= 650 + slack, `y inside: ${p.y}`);
    }
  }
});

test("a gentle turn keeps its tangent, so a curve is still a curve", () => {
  // Evenly spaced samples on a circle: the tangent must point along the circle
  // and be a chord long, so the spans bow out to the arc rather than cutting
  // straight across it.
  const angles = [0, 20, 40, 60].map((degrees) => (degrees * Math.PI) / 180);
  const stroke = {
    x: Float32Array.from(angles.map((a) => 100 * Math.cos(a))),
    y: Float32Array.from(angles.map((a) => 100 * Math.sin(a))),
    pressure: Uint8Array.from([0, 0, 0, 0]),
    width: 6,
  };
  const chord = Math.hypot(stroke.x[2]! - stroke.x[1]!, stroke.y[2]! - stroke.y[1]!);
  const m = strokeTangentAt(stroke, 1);
  const length = Math.hypot(m.x, m.y);
  assert.ok(length > 0.8 * chord && length < 1.2 * chord, `about a chord: ${length}`);
  // Along the circle at 20°: the direction is (-sin 20°, cos 20°).
  const dot = (m.x * -Math.sin(angles[1]!) + m.y * Math.cos(angles[1]!)) / length;
  assert.ok(dot > 0.999, `tangent to the circle: ${dot}`);
  const mid = strokeCurveAt(stroke, 1, 0.5);
  const radius = Math.hypot(mid.x, mid.y);
  assert.ok(Math.abs(radius - 100) < 0.5, `the span bows to the arc: r=${radius}`);
});

test("a small loop, eight samples round, is still round — not a polyline", () => {
  // A 1 mm letter loop after simplification: a sample every 45°. A tangent
  // that fades on that turn draws an octagon; the span must bow to the arc.
  const angles = Array.from({ length: 9 }, (_, i) => (i * Math.PI) / 4);
  const stroke = {
    x: Float32Array.from(angles.map((a) => 10 * Math.cos(a))),
    y: Float32Array.from(angles.map((a) => 10 * Math.sin(a))),
    pressure: Uint8Array.from(angles.map(() => 0)),
    width: 6,
  };
  for (let i = 1; i < 7; i += 1) {
    const mid = strokeCurveAt(stroke, i, 0.5);
    const radius = Math.hypot(mid.x, mid.y);
    // The chord midpoint sits at r = 10·cos 22.5° ≈ 9.24; the arc at 10.
    assert.ok(radius > 9.8 && radius < 10.2, `span ${i} bows to the arc: r=${radius}`);
  }
});

test("a long straight span next to a short chord stays straight", () => {
  // What a box edge looks like after the refit: one long span, then two short
  // chords rounding the corner. A tangent scaled to the long span bulges the
  // edge before the corner; scaled to the short chord it does not.
  const stroke = {
    x: Float32Array.from([193, 568, 575, 579, 578]),
    y: Float32Array.from([502, 502, 505, 522, 765]),
    pressure: Uint8Array.from([128, 128, 128, 128, 128]),
    width: 10,
  };
  for (let k = 0; k <= 20; k += 1) {
    const p = strokeCurveAt(stroke, 0, k / 20);
    assert.ok(Math.abs(p.y - 502) < 0.5, `the edge stays on its line: ${p.y}`);
  }
});

test("a circle drawn by hand and simplified unevenly is drawn round", () => {
  // A mouse-drawn circle as the worker committed it: 36 points, radius ~230,
  // spans from 20 to 117 units. A tangent whose length or direction is set by
  // the wrong span shows here as a facet — a flat run with a corner either
  // side — which is what the first Catmull-Rom cut drew on every circle.
  const raw =
    "1893,1008 1891,1035 1856,1134 1835,1160 1808,1187 1796,1197 1778,1208 1717,1233 1688,1238 1637,1239 1616,1235 1511,1184 1497,1173 1480,1152 1444,1090 1436,1061 1432,1037 1430,998 1439,945 1451,911 1467,882 1504,839 1532,816 1569,796 1609,783 1629,779 1656,777 1686,778 1716,783 1742,791 1785,818 1836,855 1857,884 1876,921 1886,950 1893,1007";
  const pts = raw.split(" ").map((p) => p.split(",").map(Number));
  const stroke = {
    x: Float32Array.from(pts.map((p) => p[0]!)),
    y: Float32Array.from(pts.map((p) => p[1]!)),
    pressure: new Uint8Array(pts.length).fill(128),
    width: 10,
  };
  const cx = 1661.5;
  const cy = 1008;
  // The samples themselves sit between 226.6 and 233 from the centre.
  for (let i = 0; i + 1 < pts.length; i += 1) {
    for (let k = 1; k < 8; k += 1) {
      const p = strokeCurveAt(stroke, i, k / 8);
      const r = Math.hypot(p.x - cx, p.y - cy);
      assert.ok(r > 224 && r < 235, `span ${i} at ${k / 8}: radius ${r}`);
    }
  }
});

test("backingRatio: the display's ratio while the backing store fits", () => {
  assert.equal(backingRatio(800, 1131, 1.25), 1.25);
});

test("backingRatio: lowers the ratio rather than exceeding the pixel budget", () => {
  // A4 at 4× on a 2× display would be 8700 × 12300; the cap holds it under budget.
  const ratio = backingRatio(4352, 6155, 2);
  assert.ok(ratio < 2);
  assert.ok(4352 * ratio * 6155 * ratio <= INK_MAX_BACKING_PIXELS + 1);
});

test("backingRatio: keeps a single edge under the dimension cap", () => {
  const ratio = backingRatio(9000, 100, 2);
  assert.ok(9000 * ratio <= INK_MAX_BACKING_DIMENSION + 1e-6);
});
