import { test } from "node:test";
import assert from "node:assert/strict";
import type { Milestone } from "../features/plan/domain/milestone.js";
import type { IMilestoneRepository } from "../features/plan/domain/milestone-repository.js";

function sampleMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: overrides.id ?? "m-1",
    title: overrides.title ?? "Finish chapter 2",
    description: overrides.description,
    status: overrides.status ?? "planned",
    targetDate: overrides.targetDate,
    dependencies: overrides.dependencies ?? [],
    compute: overrides.compute ?? [],
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
  };
}

export function runMilestoneRepositoryContract(
  label: string,
  makeRepo: () => IMilestoneRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const milestone = sampleMilestone();
    await repo.save(milestone);
    const found = await repo.getById(milestone.id);
    assert.ok(found);
    assert.equal(found.title, milestone.title);
  });

  test(`[${label}] list filters by status`, async () => {
    const repo = makeRepo();
    await repo.save(sampleMilestone({ id: "a", status: "done" }));
    await repo.save(sampleMilestone({ id: "b", status: "planned" }));
    const done = await repo.list({ status: "done" });
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, "a");
  });

  test(`[${label}] delete removes the milestone`, async () => {
    const repo = makeRepo();
    await repo.save(sampleMilestone());
    await repo.delete("m-1");
    assert.equal(await repo.getById("m-1"), null);
  });
}
