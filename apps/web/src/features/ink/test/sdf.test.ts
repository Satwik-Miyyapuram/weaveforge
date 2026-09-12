/**
 * The SDF pipeline's CPU half: the instance layout, the taper, and the degenerate
 * case the plan names.
 *
 * §7 step 4 asks for "`sdf.test.ts`: a zero-length segment renders a round dot".
 * The rendering itself needs a GPU, so what is asserted here is the part that
 * decides whether the shader *can*: a segment whose endpoints coincide must produce
 * a square quad of the nib's radius plus the AA margin, and the packer must give it
 * equal radii, because the fragment shader's distance has no direction to project
 * onto. The shader guards the same case a second time
 * (`max(dot(ba, ba), 0.0001)`), and that guard is quoted in the test so the two
 * halves of the fix are visible together.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_MAX_BACKING_DIMENSION,
  INK_MAX_BACKING_PIXELS,
  backingRatio,
  boundsToClip,
  INK_AA_MARGIN_PX,
  INK_INSTANCE_FLOATS,
  INK_SEGMENT_SUBDIVISIONS,
  capsuleHalfExtent,
  catmullRom,
  packStrokeInstances,
  radiusAt,
  strokeCurveAt,
  strokeTangentAt,
  strokeInstanceCount,
} from "../render/ink-renderer";

test("a zero-length segment becomes a dot, not a degenerate quad", () => {
  const dot = capsuleHalfExtent(500, 500, 500, 500, 3, 1);
  assert.equal(
    dot.degenerate,
    true,
    "the caller can tell it had no direction to work with",
  );
  assert.equal(dot.length, 0);
  assert.equal(dot.halfWidth, 4, "the nib plus the margin, both ways");
  assert.equal(dot.halfHeight, 4);
});

test("a segment shorter than its own nib is also a dot", () => {
  // Half a millimetre long with a 0.6 mm nib: the nib covers both ends, so the
  // direction is meaningless and a square is the right quad.
  const stub = capsuleHalfExtent(0, 0, 1, 0, 3, 1);
  assert.equal(stub.degenerate, true);
  assert.equal(stub.halfWidth, 4);
});

test("a real segment's quad is its box grown by the nib and the margin", () => {
  const quad = capsuleHalfExtent(0, 0, 100, 0, 3, 1);
  assert.equal(quad.degenerate, false);
  assert.equal(quad.length, 100);
  assert.equal(quad.halfWidth, 54, "half the segment plus nib plus margin");
  assert.equal(quad.halfHeight, 4, "and the nib plus margin across");

  const steep = capsuleHalfExtent(0, 0, 100, 100, 0, 1);
  assert.equal(steep.halfWidth, 51);
  assert.equal(steep.halfHeight, 51);
});

test("the AA margin is one device pixel, which is the overdraw lever", () => {
  assert.equal(INK_AA_MARGIN_PX, 1);
  const tight = capsuleHalfExtent(0, 0, 100, 0, 3, INK_AA_MARGIN_PX);
  const loose = capsuleHalfExtent(0, 0, 100, 0, 3, 4);
  assert.ok(
    loose.halfHeight > tight.halfHeight,
    "a bigger margin is a bigger quad",
  );
  // §11.3.9's numbers: the margin is what makes adjacent quads overlap, so it is
  // paid for on every segment. This is the assertion that the lever is where the
  // code says it is.
  assert.equal(loose.halfHeight - tight.halfHeight, 3);
});

test("the packer writes the subdivided spline, in the layout the shader reads", () => {
  const out = new Float32Array(INK_INSTANCE_FLOATS * 8);
  const written = packStrokeInstances(
    {
      x: Float32Array.from([0, 10, 20]),
      y: Float32Array.from([5, 5, 5]),
      pressure: Uint8Array.from([0, 0, 0]),
      width: 6,
      variableWidth: false,
    },
    out,
  );
  const perSegment = INK_INSTANCE_FLOATS * INK_SEGMENT_SUBDIVISIONS;
  assert.equal(
    written,
    perSegment * 2,
    "three points are two segments, each subdivided",
  );
  assert.equal(strokeInstanceCount(3), 2 * INK_SEGMENT_SUBDIVISIONS);
  // Collinear, evenly spaced samples: the spline is the line, so the
  // sub-segments are the thirds of it, and the layout is A.xy, B.xy, rA, rB,
  // then the neighbours: prevA.xy, nextB.xy, prevRA, nextRB.
  const third = 10 / INK_SEGMENT_SUBDIVISIONS;
  const stride = INK_INSTANCE_FLOATS;
  const first = Array.from(out.subarray(0, stride));
  assert.deepEqual(first.slice(0, 2), [0, 5]);
  assert.ok(Math.abs(first[2]! - third) < 1e-5 && first[3] === 5);
  assert.deepEqual(first.slice(4, 6), [3, 3]);
  assert.equal(first[10], -1, "the first instance has nothing before it");
  assert.ok(Math.abs(first[8]! - 2 * third) < 1e-5, "and the next ends a third on");
  assert.equal(first[11], 3);
  const last = Array.from(out.subarray(written - stride, written));
  assert.ok(Math.abs(last[0]! - (20 - third)) < 1e-5);
  assert.deepEqual(last.slice(2, 6), [20, 5, 3, 3], "the last ends on the last sample");
  assert.equal(last[11], -1, "and has nothing after it");
  assert.ok(Math.abs(last[6]! - (20 - 2 * third)) < 1e-5);
  // The chain is continuous: every instance starts where the previous ended,
  // and knows it.
  for (let at = stride; at < written; at += stride) {
    assert.equal(out[at], out[at - stride + 2]);
    assert.equal(out[at + 1], out[at - stride + 3]);
    assert.equal(out[at + 6], out[at - stride], "prev is the previous start");
    assert.equal(out[at - stride + 8], out[at + 2], "next is the following end");
  }
  assert.deepEqual(
    Array.from(out.subarray(written)).every((value) => value === 0),
    true,
    "and nothing past it",
  );
});

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
    variableWidth: false,
  };
  const mid = strokeCurveAt(stroke, 1, 0.5);
  const chord = radius * Math.cos((10 * Math.PI) / 180);
  const along = Math.hypot(mid.x, mid.y);
  assert.ok(along > chord, `outside the chord: ${along} > ${chord}`);
  assert.ok(Math.abs(along - radius) < 0.1 * radius * 0.01);
  const start = strokeCurveAt(stroke, 1, 0);
  assert.ok(Math.abs(start.x - stroke.x[1]!) < 1e-9, "and passes through the samples");
  assert.equal(catmullRom(0, 1, 2, 3, 0.25), 1.25, "a straight run is linear");
});

test("a stroke with one point has no segments, and packs to nothing", () => {
  const out = new Float32Array(INK_INSTANCE_FLOATS * 4);
  const written = packStrokeInstances(
    {
      x: Float32Array.from([100]),
      y: Float32Array.from([100]),
      pressure: Uint8Array.from([128]),
      width: 6,
      variableWidth: true,
    },
    out,
  );
  assert.equal(written, 0);
});

test("packing from a point onward appends only the new segments (D6)", () => {
  // Incremental drawing: a frame that added one point must cost one segment, not
  // the whole stroke — the flush-verified measurement was 0.5 ms against 4.8 ms.
  const points = 8;
  const out = new Float32Array(INK_INSTANCE_FLOATS * strokeInstanceCount(points));
  const stroke = {
    x: Float32Array.from(
      Array.from({ length: points }, (_unused, i) => i * 10),
    ),
    y: Float32Array.from(Array.from({ length: points }, () => 0)),
    pressure: Uint8Array.from(Array.from({ length: points }, () => 200)),
    width: 6,
    variableWidth: true,
  };
  const first = packStrokeInstances(stroke, out, { from: 0 });
  assert.equal(first, INK_INSTANCE_FLOATS * strokeInstanceCount(points));
  const grown = packStrokeInstances(stroke, out, { from: points - 2 });
  assert.equal(
    grown,
    INK_INSTANCE_FLOATS * INK_SEGMENT_SUBDIVISIONS,
    "only the last segment is repacked",
  );
  // The re-packed instance still knows the one before it, which was not.
  assert.ok(out[10]! >= 0, "a mid-stroke instance has a previous neighbour");
  assert.ok(
    Math.abs(out[6]! - ((points - 2) * 10 - 10 / INK_SEGMENT_SUBDIVISIONS)) < 1e-4,
  );
});

test("a fixed-width tool does not taper, whatever the pressure says", () => {
  // A highlighter is a marker: a 6 mm nib that narrowed with pressure would not be
  // one, and a snapped shape has no hand behind it at all.
  const fixed = { width: 60, variableWidth: false } as const;
  assert.equal(
    radiusAt(
      {
        ...fixed,
        x: Float32Array.from([0, 0]),
        y: Float32Array.from([0, 0]),
        pressure: Uint8Array.from([10, 255]),
      },
      0,
    ),
    30,
  );
  assert.equal(
    radiusAt(
      {
        ...fixed,
        x: Float32Array.from([0, 0]),
        y: Float32Array.from([0, 0]),
        pressure: Uint8Array.from([10, 255]),
      },
      1,
    ),
    30,
  );
});

test("pressure widens a pen, and a device with none keeps its width", () => {
  const base = { width: 6, variableWidth: true } as const;
  const light = radiusAt(
    {
      ...base,
      x: Float32Array.from([0, 1]),
      y: Float32Array.from([0, 0]),
      pressure: Uint8Array.from([30, 30]),
    },
    0,
  );
  const heavy = radiusAt(
    {
      ...base,
      x: Float32Array.from([0, 1]),
      y: Float32Array.from([0, 0]),
      pressure: Uint8Array.from([255, 255]),
    },
    0,
  );
  assert.ok(heavy > light, `a press is wider: ${heavy} against ${light}`);
  // A device with no pressure channel gets the base radius — but the *velocity*
  // taper still applies, because that is a property of the movement rather than of
  // the pressure, and it is a still pen where it goes away. So the point measured
  // here is one that did not move.
  const none = radiusAt(
    {
      ...base,
      x: Float32Array.from([0, 0, 0]),
      y: Float32Array.from([0, 0, 0]),
      pressure: Uint8Array.from([0, 0, 0]),
    },
    1,
  );
  assert.ok(
    Math.abs(none - 3) < 1e-6,
    "no pressure channel and no movement means the base radius",
  );
});

test("a simplified box corner is drawn as a corner, with nothing past it", () => {
  // What the save-time simplification leaves of a drawn box: one sample per
  // corner, long spans between. Uniform Catmull-Rom hooks ~15 units past each
  // corner here; the curve must stay inside the box and on its edges.
  const stroke = {
    x: Float32Array.from([100, 300, 300, 100, 100]),
    y: Float32Array.from([500, 500, 650, 650, 500]),
    pressure: Uint8Array.from([128, 128, 128, 128, 128]),
    width: 6,
    variableWidth: false,
  };
  for (let i = 0; i < 4; i += 1) {
    for (let k = 0; k <= 10; k += 1) {
      const p = strokeCurveAt(stroke, i, k / 10);
      assert.ok(p.x >= 100 - 1e-6 && p.x <= 300 + 1e-6, `x inside: ${p.x}`);
      assert.ok(p.y >= 500 - 1e-6 && p.y <= 650 + 1e-6, `y inside: ${p.y}`);
    }
  }
  const mid = strokeCurveAt(stroke, 0, 0.5);
  assert.ok(Math.abs(mid.y - 500) < 1e-6, "the top edge is straight");
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
    variableWidth: false,
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
    variableWidth: false,
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
    variableWidth: false,
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
    variableWidth: false,
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

test("boundsToClip: the camera offset is CSS pixels, scaled by the ratio like the page is", () => {
  // A view scrolled 100 CSS px into the page on a 2× display: the page's
  // corner is at -200 device px, and a stroke at page x = 50 with scale 2 is
  // at 50·2·2 − 200 = 0 — the left edge of the window.
  const clip = boundsToClip([50, 0, 100, 10], {
    scale: 2,
    offsetX: -100,
    offsetY: 0,
    devicePixelRatio: 2,
  });
  assert.equal(clip.x, 0);
  assert.equal(clip.width, 200);
});
