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
  INK_AA_MARGIN_PX,
  INK_INSTANCE_FLOATS,
  INK_SEGMENT_SUBDIVISIONS,
  capsuleHalfExtent,
  catmullRom,
  packStrokeInstances,
  radiusAt,
  strokeCurveAt,
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
  // sub-segments are the thirds of it, and the layout is A.xy, B.xy, rA, rB.
  const third = 10 / INK_SEGMENT_SUBDIVISIONS;
  const first = Array.from(out.subarray(0, 6));
  assert.deepEqual(first.slice(0, 2), [0, 5]);
  assert.ok(Math.abs(first[2]! - third) < 1e-5 && first[3] === 5);
  assert.deepEqual(first.slice(4), [3, 3]);
  const last = Array.from(out.subarray(written - 6, written));
  assert.ok(Math.abs(last[0]! - (20 - third)) < 1e-5);
  assert.deepEqual(last.slice(2), [20, 5, 3, 3], "the last ends on the last sample");
  // The chain is continuous: every instance starts where the previous ended.
  for (let at = 6; at < written; at += 6) {
    assert.equal(out[at], out[at - 4]);
    assert.equal(out[at + 1], out[at - 3]);
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
