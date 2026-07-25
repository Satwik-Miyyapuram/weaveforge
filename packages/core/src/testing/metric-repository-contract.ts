/**
 * Shared CONTRACT test suite for IMetricRepository.
 *
 * Every implementation (in-memory, Supabase) must pass this identical suite —
 * the basis for Liskov substitutability.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  IMetricRepository,
  MetricPoint,
} from "../features/experiments/domain/metric-point.js";

function pt(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    experimentId: overrides.experimentId ?? "e1",
    metric: overrides.metric ?? "loss",
    step: overrides.step ?? 0,
    value: overrides.value ?? 1,
    wallTime: overrides.wallTime,
  };
}

export function runMetricRepositoryContract(
  label: string,
  makeRepo: () => IMetricRepository,
): void {
  test(`[${label}] history is empty for an unknown experiment`, async () => {
    const repo = makeRepo();
    assert.deepEqual(await repo.history("nope"), []);
  });

  test(`[${label}] append then history returns points in step order`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ metric: "loss", step: 1, value: 0.9 }),
      pt({ metric: "loss", step: 0, value: 1.0 }),
    ]);
    const loss = await repo.history("e1", "loss");
    assert.deepEqual(loss.map((p) => p.step), [0, 1]);
    assert.deepEqual(loss.map((p) => p.value), [1.0, 0.9]);
  });

  test(`[${label}] history filters by metric`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ metric: "loss", step: 0, value: 1 }),
      pt({ metric: "acc", step: 0, value: 0.5 }),
    ]);
    const acc = await repo.history("e1", "acc");
    assert.equal(acc.length, 1);
    assert.equal(acc[0]?.metric, "acc");
  });

  test(`[${label}] history scopes to the experiment`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ experimentId: "e1", step: 0, value: 1 }),
      pt({ experimentId: "e2", step: 0, value: 2 }),
    ]);
    const e1 = await repo.history("e1");
    assert.equal(e1.length, 1);
    assert.equal(e1[0]?.experimentId, "e1");
  });
}
