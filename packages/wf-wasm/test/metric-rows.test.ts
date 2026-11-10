import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { metricRowToDomain, type MetricRowInput } from "../src/metric-rows.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const base: MetricRowInput = {
  experiment_id: "e1",
  metric: "loss",
  step: 3,
  value: 0.25,
  wall_time: "2026-04-01T10:00:00.000Z",
};

test("maps a metric row to a point with camelCase wallTime", () => {
  assert.deepEqual(metricRowToDomain(base), {
    experimentId: "e1",
    metric: "loss",
    step: 3,
    value: 0.25,
    wallTime: "2026-04-01T10:00:00.000Z",
  });
});

test("a Date wall time is normalised to an ISO string before it crosses to wasm", () => {
  const point = metricRowToDomain({ ...base, wall_time: new Date("2026-04-01T10:00:00.000Z") });
  assert.equal(point.wallTime, "2026-04-01T10:00:00.000Z");
});

test("a null wall time stays absent", () => {
  const point = metricRowToDomain({ ...base, wall_time: null });
  assert.equal("wallTime" in point, false);
});
