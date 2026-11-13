import { test } from "node:test";
import assert from "node:assert/strict";
import { type Experiment } from "../../../src/features/experiments/domain/parts.js";
import { rust } from "../../../src/shared/rust.js";

const base: Experiment = {
  id: "e1",
  name: "run",
  status: "running",
  config: {},
  metrics: {},
  artifacts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
};

test("isStaleRunningExperiment detects dead runs", () => {
  const now = Date.parse("2026-01-01T00:05:00.000Z");
  assert.equal(rust().isStaleRunningExperiment(base, now), true);
  assert.equal(rust().isStaleRunningExperiment({ ...base, status: "done" }, now), false);
  assert.equal(rust().isStaleRunningExperiment(base, Date.parse("2026-01-01T00:01:00.000Z")), false);
});

test("isStaleRunningExperiment respects recent metric activity", () => {
  const now = Date.parse("2026-01-01T00:05:00.000Z");
  const recentMetric = Date.parse("2026-01-01T00:04:30.000Z");
  assert.equal(rust().isStaleRunningExperiment(base, now, undefined, recentMetric), false);
});

test("formatMetricValue formats numbers without assuming metric type", () => {
  assert.equal(rust().formatMetricValue("accuracy", 0.7319), "0.7319");
  assert.equal(rust().formatMetricValue("val_loss", 0.2153), "0.2153");
  assert.equal(rust().formatMetricValue("custom_f1", 94.2), "94.200");
});
