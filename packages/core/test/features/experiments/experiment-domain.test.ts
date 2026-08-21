import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatMetricValue,
  isStaleRunningExperiment,
  type Experiment,
} from "../../../src/features/experiments/domain/experiment.js";

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
  assert.equal(isStaleRunningExperiment(base, now), true);
  assert.equal(isStaleRunningExperiment({ ...base, status: "done" }, now), false);
  assert.equal(isStaleRunningExperiment(base, Date.parse("2026-01-01T00:01:00.000Z")), false);
});

test("isStaleRunningExperiment respects recent metric activity", () => {
  const now = Date.parse("2026-01-01T00:05:00.000Z");
  const recentMetric = Date.parse("2026-01-01T00:04:30.000Z");
  assert.equal(isStaleRunningExperiment(base, now, undefined, recentMetric), false);
});

test("formatMetricValue formats numbers without assuming metric type", () => {
  assert.equal(formatMetricValue("accuracy", 0.7319), "0.7319");
  assert.equal(formatMetricValue("val_loss", 0.2153), "0.2153");
  assert.equal(formatMetricValue("custom_f1", 94.2), "94.200");
});
