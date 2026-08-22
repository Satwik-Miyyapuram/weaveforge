import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryExperimentRepository } from "../../../src/testing/in-memory-experiment-repository.js";
import { ManageExperimentUseCase } from "../../../src/features/experiments/application/manage-experiment.use-case.js";
import { shortSha } from "../../../src/features/experiments/domain/experiment.js";
import type {IdGenerator} from "../../../src/shared/clock.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");
function seqIds(): IdGenerator { let n = 0; return { newId: () => `id-${++n}` }; }
function uc() {
  const repo = new InMemoryExperimentRepository();
  return { repo, uc: new ManageExperimentUseCase({ repository: repo, clock, ids: seqIds() }) };
}

test("add applies defaults", async () => {
  const { uc: u } = uc();
  const e = await u.add({ name: "beta-vae sweep" });
  assert.equal(e.status, "planned");
  assert.deepEqual(e.config, {});
  assert.deepEqual(e.artifacts, []);
});

test("add rejects empty name", async () => {
  const { uc: u } = uc();
  await assert.rejects(() => u.add({ name: "  " }));
});

test("setStatus running then done stamps timestamps", async () => {
  const { uc: u } = uc();
  const e = await u.add({ name: "x" });
  const r = await u.setStatus(e.id, "running");
  assert.equal(r.startedAt, "2026-06-24T12:00:00.000Z");
  const d = await u.setStatus(e.id, "done");
  assert.equal(d.finishedAt, "2026-06-24T12:00:00.000Z");
});

test("recordMetrics merges", async () => {
  const { uc: u } = uc();
  const e = await u.add({ name: "x", metrics: { val_loss: 0.2 } });
  const r = await u.recordMetrics(e.id, { mig: 0.41 });
  assert.deepEqual(r.metrics, { val_loss: 0.2, mig: 0.41 });
});

test("shortSha truncates", () => {
  assert.equal(shortSha("a1b2c3d4e5f6"), "a1b2c3d");
  assert.equal(shortSha(undefined), undefined);
});
