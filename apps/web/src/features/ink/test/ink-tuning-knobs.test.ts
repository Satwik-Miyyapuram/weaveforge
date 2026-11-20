// The handwriting-feel knobs of `ink.tuning` are wired: changing each one
// changes what is drawn. Pure tests, no wasm (fakes stand in for the packer).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FREEDRAW_SHAPE,
  inkFreedrawPath,
  type FreedrawShape,
} from "../render/excalidraw-freedraw";
import { liveRepackFrom } from "../render/parts-1";
import { InkInputFilter, inkInputFilter, liveForRenderer, type LiveStroke } from "../worker/live-stroke";
import { predictedWithin } from "../application/pen-capture-session";
import type { PenPointerEvent } from "../application/use-pen-capture";
import {
  DEFAULT_INK_TUNING,
  INK_TUNING_KEY,
  inkTuningSettingsJson,
  inkWetDpr,
} from "../application/ink-tuning";
import { inkTuningRangeLabel } from "../ui/ink-tuning-panel";

// A pen stroke with varying pressure, long enough for tapers to show.
const points: number[][] = [];
const pressures: number[] = [];
for (let i = 0; i < 40; i += 1) {
  points.push([i * 4, Math.sin(i / 3) * 20]);
  pressures.push(0.2 + 0.6 * Math.abs(Math.sin(i / 5)));
}
// Smoothing drops points closer than size * smoothing, so it shows on a wide pen.
const penPath = (shape?: FreedrawShape, width = 12) => inkFreedrawPath(points, pressures, width, false, true, shape);

test("the default shape draws exactly what no shape draws", () => {
  assert.equal(penPath(DEFAULT_FREEDRAW_SHAPE), penPath());
});

const changed: [keyof FreedrawShape, number][] = [
  ["thinning", 0.1],
  ["smoothing", 1],
  ["streamline", 0.05],
  ["taperStart", 40],
  ["taperEnd", 40],
  ["pressureGamma", 2],
  ["minWidth", 0.6],
];
for (const [key, value] of changed) {
  test(`changing ${key} changes the pen outline`, () => {
    assert.notEqual(penPath({ ...DEFAULT_FREEDRAW_SHAPE, [key]: value }), penPath());
  });
}

test("inputSmoothing averages each position with the previous raw ones", () => {
  const filter = new InkInputFilter({ inputSmoothing: 2, resampleSpacing: 0 });
  const xs: number[] = [];
  for (const x of [0, 3, 6, 9]) {
    assert.equal(filter.accept(x, 0, 0.5), true);
    xs.push(filter.x);
  }
  assert.deepEqual(xs, [0, 1.5, 3, 6]);
});

test("resampleSpacing drops close samples and flush keeps the pen-up one", () => {
  const filter = new InkInputFilter({ inputSmoothing: 0, resampleSpacing: 5 });
  assert.equal(filter.accept(0, 0, 0.5), true);
  assert.equal(filter.accept(2, 0, 0.5), false);
  assert.equal(filter.accept(4, 0, 0.6), false);
  assert.equal(filter.accept(10, 0, 0.5), true);
  assert.equal(filter.flush(), false, "nothing held after a kept sample");
  assert.equal(filter.accept(12, 0, 0.7), false);
  assert.equal(filter.flush(), true);
  assert.deepEqual([filter.x, filter.y, filter.pressure], [12, 0, 0.7]);
});

test("with both input knobs off there is no filter, so the default path is untouched", () => {
  assert.equal(inkInputFilter(undefined), null);
  assert.equal(inkInputFilter({ inputSmoothing: 0, resampleSpacing: 0 }), null);
  assert.notEqual(inkInputFilter({ inputSmoothing: 1, resampleSpacing: 0 }), null);
  assert.notEqual(inkInputFilter({ inputSmoothing: 0, resampleSpacing: 1 }), null);
});

test("predictionMs caps the predicted samples by time; 0 keeps all", () => {
  const at = (t: number) => ({ t }) as unknown as PenPointerEvent;
  const predicted = [at(105), at(110), at(125)];
  assert.deepEqual(predictedWithin(predicted, at(100), 10).map((e) => e.t), [105, 110]);
  assert.equal(predictedWithin(predicted, at(100), 0), predicted);
});

test("wetDpr 0 is the device's ratio, otherwise its own", () => {
  assert.equal(inkWetDpr(0, 2), 2);
  assert.equal(inkWetDpr(1.5, 2), 1.5);
});

test("Copy JSON is a settings.json fragment that reads back as the tuning", () => {
  const json = JSON.parse(inkTuningSettingsJson({ ...DEFAULT_INK_TUNING, thinning: 0.3 }));
  assert.deepEqual(INK_TUNING_KEY, ["ink", "tuning"]);
  assert.deepEqual(json, { ink: { tuning: { ...DEFAULT_INK_TUNING, thinning: 0.3 } } });
});

test("the panel lists each knob's range and default", () => {
  assert.equal(inkTuningRangeLabel("thinning"), "(0–1, default 0.6)");
  assert.equal(inkTuningRangeLabel("wetDpr"), "(0 (device) or 0.5–3, default device)");
});

// --- Repack safety -------------------------------------------------------

const header = { strokeId: 1, width: 4, tool: "pen", colour: "black" } as unknown as LiveStroke["header"];

function classicStroke(read: () => Float64Array): LiveStroke {
  return {
    header,
    points: [],
    pressures: [],
    realSamples: 0,
    changed: true,
    packer: { push() {}, points: read, pressures: () => new Float64Array(0) },
    raw: false,
  } as unknown as LiveStroke;
}

test("a classic stroke reports the first point the packer revised", () => {
  let flat = new Float64Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const stroke = classicStroke(() => flat);
  assert.equal(liveForRenderer(stroke).changedFrom, 0, "first frame: everything is new");
  flat = new Float64Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(liveForRenderer(stroke).changedFrom, 5, "appended: only the new point");
  flat = new Float64Array([0, 0, 1, 9, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.equal(liveForRenderer(stroke).changedFrom, 1, "an earlier point moved");
});

test("a raw stroke reports where its new samples start", () => {
  const stroke = { ...classicStroke(() => new Float64Array(0)), raw: true } as LiveStroke;
  for (let i = 0; i < 4; i += 1) stroke.points.push(i, i);
  stroke.realSamples = 4;
  assert.equal(liveForRenderer(stroke).changedFrom, 0);
  stroke.points.push(4, 4, 5, 5);
  stroke.realSamples = 6;
  assert.equal(liveForRenderer(stroke).changedFrom, 4);
});

// A reference packer with the WebGL one's locality: segment k (point k to k+1)
// reads points k-1..k+2 (its end tangents), so moving point c changes segments
// c-2..c+1.
function segment(xs: number[], k: number): string {
  const at = (i: number) => xs[Math.max(0, Math.min(xs.length - 1, i))]!;
  return [at(k - 1), at(k), at(k + 1), at(k + 2)].join(",");
}
function fullPack(xs: number[]): string[] {
  return Array.from({ length: Math.max(0, xs.length - 1) }, (_, k) => segment(xs, k));
}
function repack(packed: string[], xs: number[], from: number): string[] {
  const out = packed.slice(0, from);
  for (let k = from; k < xs.length - 1; k += 1) out.push(segment(xs, k));
  return out;
}

test("a streamline rewrite of earlier points repacks the same as a full repack", () => {
  const before = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const packed = fullPack(before);
  // The next frame appends one point and smoothing moved point 3.
  const after = [0, 1, 2, 3.5, 4, 5, 6, 7, 8, 9, 10];
  const segments = after.length - 1;
  const incremental = repack(packed, after, liveRepackFrom(packed.length, segments, 3));
  assert.deepEqual(incremental, fullPack(after));
  // Assuming only the last two segments change (the old rule) leaves stale ones.
  const assumed = repack(packed, after, liveRepackFrom(packed.length, segments));
  assert.notDeepEqual(assumed, fullPack(after));
});

test("with no change reported the repack keeps the last-two-segments rule", () => {
  assert.equal(liveRepackFrom(9, 10), 7);
  assert.equal(liveRepackFrom(9, 10, 100), 7);
  assert.equal(liveRepackFrom(9, 10, 0), 0);
});
