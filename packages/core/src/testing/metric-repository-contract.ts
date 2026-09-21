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
  MetricBudget,
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

/**
 * The budget every case below reads with unless it is testing the reduction.
 *
 * Large enough that a series in these tests is returned whole, because the
 * behaviour under test is ordering and scoping rather than reduction.
 */
const WHOLE: MetricBudget = { maxPoints: 1000 };

export function runMetricRepositoryContract(
  label: string,
  makeRepo: () => IMetricRepository,
): void {
  test(`[${label}] history is empty for an unknown experiment`, async () => {
    const repo = makeRepo();
    assert.deepEqual(await repo.history("nope", undefined, WHOLE), []);
  });

  test(`[${label}] append then history returns points in step order`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ metric: "loss", step: 1, value: 0.9 }),
      pt({ metric: "loss", step: 0, value: 1.0 }),
    ]);
    const loss = await repo.history("e1", "loss", WHOLE);
    assert.deepEqual(loss.map((p) => p.step), [0, 1]);
    assert.deepEqual(loss.map((p) => p.value), [1.0, 0.9]);
  });

  test(`[${label}] history filters by metric`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ metric: "loss", step: 0, value: 1 }),
      pt({ metric: "acc", step: 0, value: 0.5 }),
    ]);
    const acc = await repo.history("e1", "acc", WHOLE);
    assert.equal(acc.length, 1);
    assert.equal(acc[0]?.metric, "acc");
  });

  test(`[${label}] history scopes to the experiment`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ experimentId: "e1", step: 0, value: 1 }),
      pt({ experimentId: "e2", step: 0, value: 2 }),
    ]);
    const e1 = await repo.history("e1", undefined, WHOLE);
    assert.equal(e1.length, 1);
    assert.equal(e1[0]?.experimentId, "e1");
  });

  // `latestActivityAt` decides whether a live run is still alive — the
  // experiments screen marks a run with no recent activity as abandoned — and it
  // had no contract case at all, so a fake could satisfy this suite with any
  // read-model behaviour it liked.

  test(`[${label}] latest activity is the newest clock per experiment`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ experimentId: "e1", step: 1, wallTime: "2026-01-01T10:00:00.000Z" }),
      pt({ experimentId: "e1", step: 2, wallTime: "2026-01-01T12:00:00.000Z" }),
      pt({ experimentId: "e2", step: 1, wallTime: "2026-01-01T11:00:00.000Z" }),
    ]);

    const activity = await repo.latestActivityAt(["e1", "e2"]);

    assert.equal(activity.get("e1"), Date.parse("2026-01-01T12:00:00.000Z"));
    assert.equal(activity.get("e2"), Date.parse("2026-01-01T11:00:00.000Z"));
  });

  test(`[${label}] an experiment with no clock is absent, not zero`, async () => {
    // `0` would read as a timestamp in 1970 and so as "idle since the epoch";
    // absent is the only spelling the caller understands as "no activity".
    const repo = makeRepo();
    await repo.append([pt({ experimentId: "e1", step: 1 })]);

    const activity = await repo.latestActivityAt(["e1", "never"]);

    assert.equal(activity.has("e1"), false);
    assert.equal(activity.has("never"), false);
  });

  test(`[${label}] latest activity ignores experiments not asked about`, async () => {
    const repo = makeRepo();
    await repo.append([
      pt({ experimentId: "e1", step: 1, wallTime: "2026-01-01T10:00:00.000Z" }),
      pt({ experimentId: "e2", step: 1, wallTime: "2026-01-01T11:00:00.000Z" }),
    ]);

    const activity = await repo.latestActivityAt(["e1"]);

    assert.deepEqual([...activity.keys()], ["e1"]);
  });

  // A chart is a few hundred pixels wide and a long run stores tens of
  // thousands of points per metric, so `history` takes a budget. These cases
  // are what keep the two implementations reducing the same way.

  test(`[${label}] a budget below the series length reduces it to about that`, async () => {
    const repo = makeRepo();
    await repo.append(
      Array.from({ length: 200 }, (_, step) => pt({ metric: "loss", step, value: step })),
    );

    const reduced = await repo.history("e1", "loss", { maxPoints: 10 });

    assert.ok(reduced.length >= 10 && reduced.length <= 12, `got ${reduced.length} points`);
  });

  test(`[${label}] a reduced series keeps its first and last sample`, async () => {
    // Losing either endpoint is the one reduction a reader misreads: the curve
    // looks like it started later, or stopped earlier, than the run did.
    const repo = makeRepo();
    await repo.append(
      Array.from({ length: 200 }, (_, step) => pt({ metric: "loss", step, value: step })),
    );

    const reduced = await repo.history("e1", "loss", { maxPoints: 10 });

    assert.equal(reduced[0]?.step, 0);
    assert.equal(reduced.at(-1)?.step, 199);
    assert.deepEqual(
      reduced.map((p) => p.step),
      [...reduced.map((p) => p.step)].sort((a, b) => a - b),
      "the order is still step-ascending",
    );
  });

  test(`[${label}] a series under the budget is returned whole`, async () => {
    const repo = makeRepo();
    await repo.append(
      Array.from({ length: 20 }, (_, step) => pt({ metric: "loss", step, value: step })),
    );

    const all = await repo.history("e1", "loss", { maxPoints: 100 });

    assert.equal(all.length, 20, "below the budget nothing is dropped");
  });

  test(`[${label}] a budget applies per metric, not across them`, async () => {
    // One budget for the whole result would starve the metric that sorts
    // second: the chart overlays them, and each needs its own resolution.
    const repo = makeRepo();
    for (const metric of ["loss", "acc"]) {
      await repo.append(
        Array.from({ length: 200 }, (_, step) => pt({ metric, step, value: step })),
      );
    }

    const reduced = await repo.history("e1", undefined, { maxPoints: 10 });

    assert.ok(reduced.filter((p) => p.metric === "loss").length >= 10);
    assert.ok(reduced.filter((p) => p.metric === "acc").length >= 10);
    assert.ok(reduced.length <= 24, `got ${reduced.length} points in total`);
  });
}
