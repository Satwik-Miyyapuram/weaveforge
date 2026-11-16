import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeStroke,
  encodeStroke,
  eraseHits,
  readInk,
  strokeAt,
  strokeHits,
  unreadInk,
  type InkStroke,
} from "../application/freeform-ink";

const samplePoints = [
  { x: 100.04, y: 200.06, pressure: 0.5 },
  { x: 101.5, y: 199.0, pressure: 1 },
  { x: 110.2, y: 205.7, pressure: 0 },
];

test("encoding stores the origin on 0.1 px and offsets as integer tenths of a pixel", () => {
  const stroke = encodeStroke({ id: "s1", width: 2, colour: "#112233", points: samplePoints });
  assert.equal(stroke.x, 100);
  assert.equal(stroke.y, 200.1);
  assert.deepEqual(stroke.p, [0, 0, 15, -11, 102, 56]);
  assert.deepEqual(stroke.r, [128, 255, 0]);
  assert.equal(stroke.w, 2);
  assert.equal(stroke.c, "#112233");
  assert.equal(stroke.t, "pen");
  assert.equal(stroke.id, "s1");
});

test("every stored number is an integer or a 0.1 origin, never a float offset", () => {
  const stroke = encodeStroke({ id: "s2", width: 3, colour: "#000000", points: samplePoints });
  for (const v of stroke.p) assert.ok(Number.isInteger(v));
  assert.ok(stroke.r);
  for (const v of stroke.r) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
});

test("decoding returns the points within 0.1 px and pressure within 1/255", () => {
  const stroke = encodeStroke({ id: "s3", width: 2, colour: "#000000", points: samplePoints });
  const back = decodeStroke(stroke);
  assert.equal(back.length, 3);
  samplePoints.forEach((want, i) => {
    const got = back[i];
    assert.ok(got, `point ${i} decoded`);
    assert.ok(Math.abs(got.x - want.x) <= 0.1);
    assert.ok(Math.abs(got.y - want.y) <= 0.1);
    assert.ok(Math.abs(got.pressure - want.pressure) <= 1 / 255);
  });
});

test("pressure outside 0 to 1 is clamped", () => {
  const stroke = encodeStroke({
    id: "s4",
    width: 1,
    colour: "#000000",
    points: [
      { x: 0, y: 0, pressure: 7 },
      { x: 1, y: 1, pressure: -3 },
    ],
  });
  assert.deepEqual(stroke.r, [255, 0]);
});

test("a stroke hits when the point is within the radius plus half its width of the line", () => {
  const stroke: InkStroke = encodeStroke({
    id: "h1",
    width: 4,
    colour: "#000000",
    points: [
      { x: 0, y: 0, pressure: 1 },
      { x: 100, y: 0, pressure: 1 },
    ],
  });
  assert.equal(strokeHits(stroke, { x: 50, y: 2 }, 1), true);
  assert.equal(strokeHits(stroke, { x: 50, y: 20 }, 1), false);
});

test("a point past the end of a segment is measured to the end point", () => {
  const stroke = encodeStroke({
    id: "h2",
    width: 0,
    colour: "#000000",
    points: [
      { x: 0, y: 0, pressure: 1 },
      { x: 10, y: 0, pressure: 1 },
    ],
  });
  assert.equal(strokeHits(stroke, { x: 13, y: 4 }, 4), false);
  assert.equal(strokeHits(stroke, { x: 13, y: 4 }, 5), true);
});

test("eraseHits returns the ids of the strokes the eraser touches and no others", () => {
  const near = encodeStroke({
    id: "a",
    width: 2,
    colour: "#000000",
    points: [
      { x: 0, y: 0, pressure: 1 },
      { x: 10, y: 0, pressure: 1 },
    ],
  });
  const far = encodeStroke({
    id: "b",
    width: 2,
    colour: "#000000",
    points: [
      { x: 0, y: 100, pressure: 1 },
      { x: 10, y: 100, pressure: 1 },
    ],
  });
  assert.deepEqual(eraseHits([near, far], { x: 5, y: 1 }, 2), ["a"]);
});

test("readInk keeps well-formed strokes and drops malformed ones without throwing", () => {
  const good = encodeStroke({ id: "ok", width: 2, colour: "#000000", points: samplePoints });
  const value = [good, null, "text", { id: 3 }, { ...good, p: [1, 2, 3] }];
  assert.deepEqual(readInk(value), [good]);
});

test("readInk of a value that is not an array is empty", () => {
  assert.deepEqual(readInk(undefined), []);
  assert.deepEqual(readInk({ nope: true }), []);
});

test("readInk accepts strokes without pressure and without a tool", () => {
  const bare = { id: "rust", x: 1, y: 2, w: 2, c: "#000000", t: "pen", p: [0, 0, 10, 0] };
  const empty = { ...bare, id: "excalidraw", r: [] };
  const noTool = { id: "old", x: 0, y: 0, w: 1, c: "#000000", p: [0, 0] };
  const read = readInk([bare, empty, noTool]);
  assert.deepEqual(read.map((s) => s.id), ["rust", "excalidraw", "old"]);
  assert.equal(read[2]?.t, "pen");
});

test("a stroke without pressure decodes every point at constant pressure and can be hit", () => {
  const bare = { id: "rust", x: 1, y: 2, w: 2, c: "#000000", t: "pen", p: [0, 0, 100, 0] } as InkStroke;
  const points = decodeStroke(bare);
  assert.equal(points.length, 2);
  assert.deepEqual(points[1], { x: 11, y: 2, pressure: 0.5 });
  assert.equal(points[0]?.pressure, 0.5);
  assert.equal(strokeHits(bare, { x: 6, y: 2.5 }, 0), true);
  assert.equal(decodeStroke({ ...bare, r: [] }).length, 2);
});

test("strokeAt finds the topmost stroke under a press, or none", () => {
  const low: InkStroke = { id: "low", x: 0, y: 0, w: 2, c: "#000000", t: "pen", p: [0, 0, 1000, 0] };
  const high: InkStroke = { ...low, id: "high" };
  const far: InkStroke = { ...low, id: "far", y: 500 };
  assert.equal(strokeAt([low, high, far], { x: 50, y: 3 }, 5), "high");
  assert.equal(strokeAt([low, far], { x: 50, y: 3 }, 5), "low");
  assert.equal(strokeAt([low, high], { x: 50, y: 100 }, 5), undefined);
});

test("unreadInk returns the items readInk cannot use, in order", () => {
  const good = encodeStroke({ id: "ok", width: 2, colour: "#000000", points: samplePoints });
  const later = { id: "v2", kind: "shape" };
  assert.deepEqual(unreadInk([good, "junk", later]), ["junk", later]);
  assert.deepEqual(unreadInk(undefined), []);
});
