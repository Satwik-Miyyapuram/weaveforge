import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEEP_ALL_BELOW_STEP,
  isOnSamplingGrid,
  planSeriesIngest,
  stepsToPrune,
  strideForStep,
} from "@weaveforge/core";

const pt = (step: number) => ({ step });

test("downsample: every point below the threshold is kept", () => {
  for (const step of [0, 1, 7, 999, KEEP_ALL_BELOW_STEP - 1]) {
    assert.equal(strideForStep(step), 1, `stride at ${step}`);
    assert.ok(isOnSamplingGrid(step), `step ${step} should be kept`);
  }
});

test("downsample: the stride doubles once per octave past the threshold", () => {
  assert.equal(strideForStep(KEEP_ALL_BELOW_STEP), 1);
  assert.equal(strideForStep(15_000), 2);
  assert.equal(strideForStep(20_000), 2);
  assert.equal(strideForStep(20_001), 4);
  assert.equal(strideForStep(40_000), 4);
  assert.equal(strideForStep(80_000), 8);
  assert.equal(strideForStep(640_000), 64);
});

test("downsample: the grid thins but never empties", () => {
  assert.ok(isOnSamplingGrid(15_000), "even step in a stride-2 octave");
  assert.ok(!isOnSamplingGrid(15_001), "odd step in a stride-2 octave");
  assert.ok(isOnSamplingGrid(40_000), "multiple of 4 in a stride-4 octave");
  assert.ok(!isOnSamplingGrid(30_002), "not a multiple of 4 in a stride-4 octave");
});

test("downsample: storage grows logarithmically, which is the whole point", () => {
  // The plan's target: a long run must not scale linearly on disk.
  const kept = (upTo: number) => {
    let n = 0;
    for (let s = 0; s < upTo; s++) if (isOnSamplingGrid(s)) n++;
    return n;
  };
  const at100k = kept(100_000);
  const at400k = kept(400_000);

  assert.ok(at100k < 30_000, `100k-step run kept ${at100k}`);
  assert.ok(at400k < 45_000, `400k-step run kept ${at400k}`);
  // Quadrupling the run must cost far less than quadrupling the storage.
  assert.ok(at400k < at100k * 2, `400k kept ${at400k} vs 100k kept ${at100k}`);
});

test("downsample: a short run is stored in full", () => {
  const points = Array.from({ length: 500 }, (_, i) => pt(i));
  const { keep, supersededTipStep } = planSeriesIngest(points, null);
  assert.equal(keep.length, 500);
  assert.equal(supersededTipStep, null);
});

test("downsample: the newest point survives even off-grid", () => {
  // 30_001 is not a multiple of 4, so the grid alone would drop it.
  assert.ok(!isOnSamplingGrid(30_001));
  const { keep } = planSeriesIngest([pt(30_000), pt(30_001)], null);
  assert.deepEqual(keep.map((p) => p.step), [30_000, 30_001]);
});

test("downsample: an off-grid tip is removed once a later point supersedes it", () => {
  const { keep, supersededTipStep } = planSeriesIngest([pt(30_004), pt(30_005)], 30_001);
  assert.equal(supersededTipStep, 30_001, "the stale tip should be cleaned up");
  assert.deepEqual(keep.map((p) => p.step), [30_004, 30_005]);
});

test("downsample: an on-grid previous tip is never deleted", () => {
  const { supersededTipStep } = planSeriesIngest([pt(30_005)], 30_000);
  assert.equal(supersededTipStep, null, "30_000 is on the grid and must stay");
});

test("downsample: a tip that is still the newest is not deleted", () => {
  // Out-of-order or duplicate delivery must not remove the current tip.
  const { supersededTipStep } = planSeriesIngest([pt(20_002)], 30_001);
  assert.equal(supersededTipStep, null);
});

test("downsample: the decision does not depend on how points are batched", () => {
  const all = Array.from({ length: 2_000 }, (_, i) => pt(29_000 + i));

  const oneGo = new Set(planSeriesIngest(all, null).keep.map((p) => p.step));

  // Same points, delivered in chunks of 37, carrying the tip forward.
  const chunked = new Set<number>();
  let prevMax: number | null = null;
  for (let i = 0; i < all.length; i += 37) {
    const batch = all.slice(i, i + 37);
    const { keep, supersededTipStep } = planSeriesIngest(batch, prevMax);
    for (const p of keep) chunked.add(p.step);
    if (supersededTipStep !== null) chunked.delete(supersededTipStep);
    prevMax = Math.max(...batch.map((p) => p.step));
  }

  assert.deepEqual([...chunked].sort((a, b) => a - b), [...oneGo].sort((a, b) => a - b));
});

test("downsample: replaying the same batch changes nothing", () => {
  const batch = [pt(50_000), pt(50_001), pt(50_004)];
  const first = planSeriesIngest(batch, null);
  const again = planSeriesIngest(batch, Math.max(...batch.map((p) => p.step)));
  assert.deepEqual(
    first.keep.map((p) => p.step),
    again.keep.map((p) => p.step),
  );
  assert.equal(again.supersededTipStep, null, "a replay must not delete its own tip");
});

test("downsample: an empty batch is a no-op", () => {
  const { keep, supersededTipStep } = planSeriesIngest([], 10);
  assert.deepEqual(keep, []);
  assert.equal(supersededTipStep, null);
});

test("retention: pruning agrees with what ingest would have kept", () => {
  const stored = [0, 100, 15_000, 15_001, 30_002, 30_004, 30_005];
  const pruned = stepsToPrune(stored);
  // 15_001 and 30_002 are off-grid and not the newest.
  assert.deepEqual(pruned, [15_001, 30_002]);
  // The newest survives even though it is off-grid.
  assert.ok(!pruned.includes(30_005));
});

test("retention: a fully on-grid series is left alone", () => {
  assert.deepEqual(stepsToPrune([0, 1, 2, 3]), []);
  assert.deepEqual(stepsToPrune([]), []);
});
