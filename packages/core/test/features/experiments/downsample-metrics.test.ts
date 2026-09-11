/**
 * `stepsToPrune` is the retention backstop that runs over an *already stored*
 * series — so its input is, by construction, the largest one the schema holds.
 * These tests pin that: the big case is what used to break it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  KEEP_ALL_BELOW_STEP,
  isOnSamplingGrid,
  planSeriesIngest,
  stepsToPrune,
  strideForStep,
} from "../../../src/features/experiments/domain/downsample-metrics.js";

test("nothing is pruned from an empty series", () => {
  assert.deepEqual(stepsToPrune([]), []);
});

test("a small series keeps every grid point and its newest point", () => {
  // Below KEEP_ALL_BELOW_STEP the stride is 1, so everything is on the grid.
  const steps = [0, 1, 2, 3, 4, 5, 6];
  assert.deepEqual(stepsToPrune(steps), []);
  for (const step of steps) assert.equal(isOnSamplingGrid(step), true);
});

test("off-grid points are pruned but the newest one always survives", () => {
  // Past the threshold the stride doubles per octave: at 20 000 it is 2, so
  // odd steps are off the grid.
  const stride = strideForStep(KEEP_ALL_BELOW_STEP * 2);
  assert.ok(stride >= 2, "expected a stride above 1 past the threshold");
  const firstOffGrid = KEEP_ALL_BELOW_STEP + 1;
  assert.equal(isOnSamplingGrid(firstOffGrid), false);

  const steps = [KEEP_ALL_BELOW_STEP, firstOffGrid, KEEP_ALL_BELOW_STEP * 2];
  const pruned = stepsToPrune(steps);
  assert.deepEqual(pruned, [firstOffGrid]);

  // A series whose newest point is itself off-grid: it survives anyway, so
  // there is nothing left to delete.
  const tipIsOffGrid = firstOffGrid * 2 + 1;
  assert.equal(isOnSamplingGrid(tipIsOffGrid), false);
  assert.deepEqual(stepsToPrune([KEEP_ALL_BELOW_STEP, tipIsOffGrid]), []);
});

test("a genuinely large series is pruned instead of overflowing the stack", () => {
  // 200 000 steps reproduces the `Math.max(...steps)` RangeError (V8 gives out
  // somewhere around 125 000 arguments) while staying fast and small enough to
  // allocate: one number per step, not a point per step.
  const count = 200_000;
  // Every step from 100 000 onwards, so most of them are off the sampling grid.
  const steps = new Array<number>(count);
  for (let i = 0; i < count; i += 1) steps[i] = 100_000 + i;
  const maxStep = steps[count - 1]!;

  let pruned: number[] = [];
  assert.doesNotThrow(() => {
    pruned = stepsToPrune(steps);
  });

  // The newest point survives, whatever its grid alignment...
  assert.equal(pruned.includes(maxStep), false);
  // ...and everything pruned is genuinely off-grid.
  assert.ok(pruned.length > 0);
  for (const step of pruned) assert.equal(isOnSamplingGrid(step), false);
  // Nothing on the grid and nothing at the tip was dropped.
  assert.equal(
    pruned.length,
    steps.filter((s) => s !== maxStep && !isOnSamplingGrid(s)).length,
  );

  // And the decision still agrees with what ingest would have kept.
  const { keep } = planSeriesIngest(
    steps.map((step) => ({ step })),
    null,
  );
  assert.equal(keep.length + pruned.length, steps.length);
});

test("the newest point is found by value, not by position", () => {
  // The maximum is not assumed to be last: the pruner is fed rows in whatever
  // order the database returned them.
  assert.deepEqual(stepsToPrune([KEEP_ALL_BELOW_STEP * 2, 10_001, 10_002]), [10_001]);
  assert.deepEqual(stepsToPrune([10_001, KEEP_ALL_BELOW_STEP * 2, 10_002]), [10_001]);
});
