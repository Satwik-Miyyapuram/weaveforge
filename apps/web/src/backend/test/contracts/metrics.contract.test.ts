// contract-repos: experiment_metrics
import assert from "node:assert/strict";
import test from "node:test";
import type { MetricBudget, MetricPoint } from "@weaveforge/core";
import { rustMetricRepository } from "@/features/experiments/infrastructure/parts";
import { testDb } from "../pg-test-db";
import { clientFor, type Db } from "./harness";

/**
 * The `IMetricRepository` contract, end to end: Rust plans each query, the TS sender
 * runs it against PGlite with the real migrations and RLS. Ported from the deleted
 * `metric-repository-contract.ts` suite. Points need a parent experiment row, so each
 * test seeds its own experiments first.
 */

/** Large enough that a series is returned whole, so ordering and scoping are what is tested. */
const WHOLE: MetricBudget = { maxPoints: 1000 };

async function fixture(db: Db) {
  const userId = await db.createUser();
  const repo = rustMetricRepository(clientFor(db, userId));
  const experiment = async (): Promise<string> => {
    const [row] = await db.as(userId).sql<{ id: string }>(
      "insert into experiments (user_id, name, status) values ($1, 'Run', 'running') returning id",
      [userId],
    );
    return row!.id;
  };
  return { repo, experiment };
}

function pt(experimentId: string, overrides: Partial<MetricPoint> = {}): MetricPoint {
  return { experimentId, metric: "loss", step: 0, value: 1, ...overrides };
}

test("history is empty for an unknown experiment", async () => {
  const { repo } = await fixture(await testDb());
  assert.deepEqual(await repo.history(crypto.randomUUID(), undefined, WHOLE), []);
});

test("append then history returns points in step order", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  await repo.append([
    pt(e1, { metric: "loss", step: 1, value: 0.9 }),
    pt(e1, { metric: "loss", step: 0, value: 1.0 }),
  ]);
  const loss = await repo.history(e1, "loss", WHOLE);
  assert.deepEqual(loss.map((p) => p.step), [0, 1]);
  assert.deepEqual(loss.map((p) => p.value), [1.0, 0.9]);
});

test("history filters by metric", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  await repo.append([
    pt(e1, { metric: "loss", step: 0, value: 1 }),
    pt(e1, { metric: "acc", step: 0, value: 0.5 }),
  ]);
  const acc = await repo.history(e1, "acc", WHOLE);
  assert.equal(acc.length, 1);
  assert.equal(acc[0]?.metric, "acc");
});

test("history scopes to the experiment", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  const e2 = await experiment();
  await repo.append([
    pt(e1, { step: 0, value: 1 }),
    pt(e2, { step: 0, value: 2 }),
  ]);
  const found = await repo.history(e1, undefined, WHOLE);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.experimentId, e1);
});

test("latest activity ignores experiments not asked about", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  const e2 = await experiment();
  await repo.append([
    pt(e1, { step: 1, wallTime: "2026-01-01T10:00:00.000Z" }),
    pt(e2, { step: 1, wallTime: "2026-01-01T11:00:00.000Z" }),
  ]);
  const activity = await repo.latestActivityAt([e1]);
  assert.deepEqual([...activity.keys()], [e1]);
});

test("a reduced series keeps its first and last sample", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  await repo.append(
    Array.from({ length: 200 }, (_, step) => pt(e1, { metric: "loss", step, value: step })),
  );
  const reduced = await repo.history(e1, "loss", { maxPoints: 10 });
  // Losing either endpoint makes the curve look like it started later or stopped earlier.
  assert.equal(reduced[0]?.step, 0);
  assert.equal(reduced.at(-1)?.step, 199);
  assert.deepEqual(
    reduced.map((p) => p.step),
    [...reduced.map((p) => p.step)].sort((a, b) => a - b),
    "the order is still step-ascending",
  );
});

test("a budget applies per metric, not across them", async () => {
  const { repo, experiment } = await fixture(await testDb());
  const e1 = await experiment();
  for (const metric of ["loss", "acc"]) {
    await repo.append(
      Array.from({ length: 200 }, (_, step) => pt(e1, { metric, step, value: step })),
    );
  }
  const reduced = await repo.history(e1, undefined, { maxPoints: 10 });
  assert.ok(reduced.filter((p) => p.metric === "loss").length >= 10);
  assert.ok(reduced.filter((p) => p.metric === "acc").length >= 10);
  assert.ok(reduced.length <= 24, `got ${reduced.length} points in total`);
});
