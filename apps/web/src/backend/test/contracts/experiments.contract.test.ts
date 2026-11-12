// contract-repos: experiments, milestones
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Experiment, Milestone } from "@weaveforge/core";
import { rustExperimentRepository } from "@/features/experiments/infrastructure/parts";
import { rustMilestoneRepository } from "@/features/plan/infrastructure/milestone-rows";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, type Db } from "./harness";

/**
 * The `IExperimentRepository` and `IMilestoneRepository` contracts, end to end: Rust
 * plans each query, the TS sender runs it against PGlite with the real migrations
 * and RLS. Ported from the deleted `experiment-repository-contract.ts` and
 * `milestone-repository-contract.ts` suites.
 */

async function experimentRepoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustExperimentRepository(clientFor(db, userId), projectFor(projectId));
}

async function milestoneRepoFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  return rustMilestoneRepository(clientFor(db, userId), projectFor(projectId));
}

function sampleExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: crypto.randomUUID(),
    name: "baseline-vae",
    status: "planned",
    config: {},
    metrics: {},
    artifacts: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

function sampleMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: crypto.randomUUID(),
    title: "Finish chapter 2",
    status: "planned",
    dependencies: [],
    compute: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("experiments", () => {
  test("save then getById returns the entity", async () => {
    const repo = await experimentRepoFor(await testDb());
    const exp = sampleExperiment();
    await repo.save(exp);
    const found = await repo.getById(exp.id);
    assert.ok(found);
    assert.equal(found.name, exp.name);
  });

  test("list filters by status", async () => {
    const repo = await experimentRepoFor(await testDb());
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.save(sampleExperiment({ id: a, status: "done" }));
    await repo.save(sampleExperiment({ id: b, status: "planned" }));
    const done = await repo.list({ status: "done" });
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, a);
  });

  test("delete removes the experiment", async () => {
    const repo = await experimentRepoFor(await testDb());
    const exp = sampleExperiment();
    await repo.save(exp);
    await repo.delete(exp.id);
    assert.equal(await repo.getById(exp.id), null);
  });
});

describe("milestones", () => {
  test("save then getById returns the entity", async () => {
    const repo = await milestoneRepoFor(await testDb());
    const milestone = sampleMilestone();
    await repo.save(milestone);
    const found = await repo.getById(milestone.id);
    assert.ok(found);
    assert.equal(found.title, milestone.title);
  });

  test("list filters by status", async () => {
    const repo = await milestoneRepoFor(await testDb());
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.save(sampleMilestone({ id: a, status: "done" }));
    await repo.save(sampleMilestone({ id: b, status: "planned" }));
    const done = await repo.list({ status: "done" });
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, a);
  });

  test("delete removes the milestone", async () => {
    const repo = await milestoneRepoFor(await testDb());
    const milestone = sampleMilestone();
    await repo.save(milestone);
    await repo.delete(milestone.id);
    assert.equal(await repo.getById(milestone.id), null);
  });
});
