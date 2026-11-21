// The live input-to-draw figure the tuning panel shows: a fixed window of the
// latest frames, p50 and p95 over it.
import assert from "node:assert/strict";
import test from "node:test";

import { LatencyWindow } from "../application/ink-latency";

test("an empty window has no figures", () => {
  const w = new LatencyWindow(8);
  assert.deepEqual(w.summary(), { count: 0, p50: null, p95: null });
});

test("p50 and p95 over the samples", () => {
  const w = new LatencyWindow(100);
  for (let i = 1; i <= 100; i += 1) w.push(i);
  const s = w.summary();
  assert.equal(s.count, 100);
  assert.equal(s.p50, 50);
  assert.equal(s.p95, 95);
});

test("only the latest samples count once the window is full", () => {
  const w = new LatencyWindow(4);
  for (const ms of [100, 100, 100, 100, 1, 2, 3, 4]) w.push(ms);
  assert.equal(w.summary().p95, 4);
  assert.equal(w.summary().count, 4);
});

test("a bad sample is ignored", () => {
  const w = new LatencyWindow(4);
  w.push(Number.NaN);
  w.push(-5);
  assert.equal(w.summary().count, 0);
});
