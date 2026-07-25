import { test } from "node:test";
import assert from "node:assert/strict";
import type { Experiment } from "../features/experiments/domain/experiment.js";
import type { IExperimentRepository } from "../features/experiments/domain/experiment-repository.js";

function sampleExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: overrides.id ?? "exp-1",
    name: overrides.name ?? "baseline-vae",
    hypothesis: overrides.hypothesis,
    status: overrides.status ?? "planned",
    config: overrides.config ?? {},
    metrics: overrides.metrics ?? {},
    artifacts: overrides.artifacts ?? [],
    relatedPaper: overrides.relatedPaper,
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
  };
}

export function runExperimentRepositoryContract(
  label: string,
  makeRepo: () => IExperimentRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const exp = sampleExperiment();
    await repo.save(exp);
    const found = await repo.getById(exp.id);
    assert.ok(found);
    assert.equal(found.name, exp.name);
  });

  test(`[${label}] list filters by status`, async () => {
    const repo = makeRepo();
    await repo.save(sampleExperiment({ id: "a", status: "done" }));
    await repo.save(sampleExperiment({ id: "b", status: "planned" }));
    const done = await repo.list({ status: "done" });
    assert.equal(done.length, 1);
    assert.equal(done[0]?.id, "a");
  });

  test(`[${label}] delete removes the experiment`, async () => {
    const repo = makeRepo();
    await repo.save(sampleExperiment());
    await repo.delete("exp-1");
    assert.equal(await repo.getById("exp-1"), null);
  });
}
