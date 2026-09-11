/**
 * The 1-Euro filter, on the four signals the plan names (§6.2.5).
 *
 * These are the tests that keep the retraction honest. Revision 2 banned position
 * filtering outright; this file asserts the four properties that make the ban
 * unnecessary — jitter is damped, a step still arrives, a slow staircase is
 * smoothed, and a fast sweep is not dragged behind the pen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_POSITION_FILTER,
  INK_PRESSURE_FILTER,
  NibFilter,
  OneEuroFilter,
  oneEuroAlpha,
} from "../application/one-euro-filter";

/** Feed a channel a series of values 8 ms apart, as a 120 Hz pen would. */
function run(filter: OneEuroFilter, values: readonly number[], step = 8): number[] {
  return values.map((value, index) => filter.filter(value, index * step));
}

test("the smoothing factor rises with the cutoff and never exceeds one", () => {
  assert.ok(oneEuroAlpha(1000, 8) > 0.97, `a very high cutoff is nearly the identity: ${oneEuroAlpha(1000, 8)}`);
  assert.ok(oneEuroAlpha(1, 8) < oneEuroAlpha(10, 8), "a lower cutoff damps harder");
  assert.ok(oneEuroAlpha(1, 0) < 1, "a zero timestep cannot divide by zero");
  // The unit slip this pins: cutoffs are per second and a pen reports
  // milliseconds, so at 120 Hz a 1 Hz cutoff is heavy damping, not none.
  assert.ok(oneEuroAlpha(1, 8) < 0.1, `1 Hz at 120 Hz should damp hard: ${oneEuroAlpha(1, 8)}`);
});

test("a jittery pressure ramp is smoothed: its roughness collapses", () => {
  const filter = new OneEuroFilter(INK_PRESSURE_FILTER);
  const ramp = Array.from({ length: 60 }, (_unused, i) => 0.3 + i * 0.01);
  const noisy = ramp.map((value, i) => value + (i % 2 === 0 ? 0.05 : -0.05));
  const filtered = run(filter, noisy);

  // Roughness — the mean second difference — is the property a low-pass changes:
  // the alternating component is what the pen's sensor noise looks like, and what
  // the filter exists to take off. Mean error is the wrong measure, because a
  // filter that tracked the *ramp* and kept the jitter would score the same.
  const roughness = (series: readonly number[]) => {
    let total = 0;
    for (let i = 2; i < series.length; i += 1) {
      total += Math.abs(series[i]! - 2 * series[i - 1]! + series[i - 2]!);
    }
    return total / (series.length - 2);
  };
  assert.ok(
    roughness(filtered) < roughness(noisy) / 4,
    `filtered roughness ${roughness(filtered).toFixed(5)} against raw ${roughness(noisy).toFixed(5)}`,
  );
  // And the ramp itself is still followed: the pen pressing harder is not lost.
  // The raw signal ends at the ramp plus a jitter sample; the filter lands
  // between the two, because that is what damping the jitter means.
  assert.ok(
    filtered.at(-1)! > 0.8 && filtered.at(-1)! <= Math.max(...noisy),
    `the ramp came through, ending at ${filtered.at(-1)!.toFixed(3)}`,
  );
});

test("a deliberate step in pressure is not over-damped: it arrives", () => {
  const filter = new OneEuroFilter(INK_PRESSURE_FILTER);
  const values = [...new Array(10).fill(0.2), ...new Array(30).fill(0.9)];
  const filtered = run(filter, values);
  const settled = filtered.at(-1)!;
  assert.ok(settled > 0.88, `a press that holds reaches the new value, got ${settled.toFixed(3)}`);
  assert.ok(filtered[9]! < 0.35, "and it has not jumped before the step arrives");
});

test("a slow staircased position is smoothed into a line", () => {
  // A digitiser quantising a slow drag: the same value for five samples at 40 ms
  // (25 mm/s), then ten units — a millimetre — on. Unfiltered this is visible
  // staircasing; the filter should round the treads without holding the pen back.
  const staircase = [
    0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 30, 30, 30, 30, 30,
  ];
  const filter = new OneEuroFilter(INK_POSITION_FILTER);
  const filtered = run(filter, staircase, 40);

  const roughness = (series: readonly number[]) => {
    let total = 0;
    for (let i = 2; i < series.length; i += 1) {
      total += Math.abs(series[i]! - 2 * series[i - 1]! + series[i - 2]!);
    }
    return total / (series.length - 2);
  };
  assert.ok(
    roughness(filtered) < roughness(staircase),
    "the treads are rounded rather than stepped: " +
      `${roughness(filtered).toFixed(3)} against ${roughness(staircase).toFixed(3)}`,
  );
  const worst = Math.max(...filtered.map((value, i) => Math.abs(value - staircase[i]!)));
  assert.ok(worst < 5, `never more than half a tread behind: ${worst.toFixed(2)}`);
  assert.ok(
    filtered.some((value, i) => Math.abs(value - staircase[i]!) > 0.5),
    "and the curve is genuinely smoothed rather than passed through",
  );
  for (let i = 1; i < filtered.length; i += 1) {
    assert.ok(filtered[i]! >= filtered[i - 1]! - 1e-9, "a monotone drag stays monotone");
  }
  // It never overshoots where the pen went — the property that matters for a mark
  // on a page: a filter may lag, but it must not draw outside the stroke.
  assert.ok(
    filtered.at(-1)! > 27 && filtered.at(-1)! <= 30,
    `ended at ${filtered.at(-1)!.toFixed(2)} of 30`,
  );
});

test("a fast straight sweep is not dragged behind the pen", () => {
  // 120 Hz at 40 units a sample is 4 mm per 8 ms — a fast stroke.
  const sweep = Array.from({ length: 40 }, (_unused, i) => i * 40);
  const filter = new OneEuroFilter(INK_POSITION_FILTER);
  const filtered = run(filter, sweep);
  // After a few samples of a constant velocity the filter has phased out, so the
  // lag is a small fraction of one sample — the property revision 2's blanket ban
  // was protecting, and the reason the ban was unnecessary.
  for (let i = 20; i < sweep.length; i += 1) {
    const lag = sweep[i]! - filtered[i]!;
    assert.ok(lag < 4, `sample ${i} lagged ${lag.toFixed(2)} units of a 40-unit step`);
  }
});

test("the first sample of a stroke passes through untouched", () => {
  const filter = new OneEuroFilter(INK_POSITION_FILTER);
  assert.equal(filter.filter(1200, 1000), 1200, "a stroke must begin where the pen went down");
  assert.equal(filter.last, 1200);
  filter.reset();
  assert.equal(filter.last, null, "a new stroke starts with no state");
});

test("two samples with the same timestamp do not poison the filter", () => {
  const filter = new OneEuroFilter(INK_POSITION_FILTER);
  filter.filter(10, 100);
  filter.filter(20, 100);
  const value = filter.filter(30, 108);
  assert.ok(Number.isFinite(value), "a zero timestep must not produce NaN");
});

test("the nib filter reports the raw speed, which is what the taper reads", () => {
  const nib = new NibFilter();
  const first = nib.filter({ x: 0, y: 0, pressure: 0.7, t: 0 });
  assert.equal(first.velocity, 0, "there is no speed before there are two samples");
  const second = nib.filter({ x: 30, y: 40, pressure: 0.7, t: 10 });
  assert.equal(second.velocity, 5, "50 units in 10 ms is 5 units per ms");
  nib.reset();
  assert.equal(nib.filter({ x: 0, y: 0, pressure: 0.7, t: 0 }).velocity, 0);
});

test("a device that reports no pressure has its pressure left alone", () => {
  const nib = new NibFilter();
  // 0 means "no pressure channel"; 0.5 is a mouse with its button down.
  const none = nib.filter({ x: 0, y: 0, pressure: 0, t: 0 });
  assert.equal(none.pressure, 0);
  const mouse = nib.filter({ x: 10, y: 0, pressure: 0.5, t: 8 });
  assert.equal(mouse.pressure, 0.5, "filtering 0.5 toward 0 would invent a pressure signal");
  nib.reset();
  const pen = nib.filter({ x: 0, y: 0, pressure: 0.2, t: 0 });
  assert.equal(pen.pressure, 0.2);
  const press = nib.filter({ x: 10, y: 0, pressure: 0.9, t: 8 });
  assert.ok(press.pressure > 0.2 && press.pressure < 0.9, "a real press is filtered, not passed");
});

test("position and pressure are filtered as one state, so the trail and the ink agree", () => {
  // The plan's warning: two filters, or a filter on one side, reintroduces the
  // seam at pen-up. One object means one answer.
  const nib = new NibFilter();
  const sample = nib.filter({ x: 100, y: 200, pressure: 0.6, t: 0 });
  assert.deepEqual(
    { x: sample.x, y: sample.y, pressure: sample.pressure },
    { x: 100, y: 200, pressure: 0.6 },
  );
  assert.ok(nib.speed >= 0, "the filter exposes the speed its cutoff is derived from");
});
