import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageExperimentUseCase,
  ExperimentValidationError,
  type Experiment,
  type IExperimentRepository,
} from "../src/index.js";

class InMemoryExperimentRepo implements IExperimentRepository {
  readonly rows = new Map<string, Experiment>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(e: Experiment) {
    this.rows.set(e.id, e);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

function makeUseCase(now = "2026-07-23T09:00:00.000Z") {
  const repo = new InMemoryExperimentRepo();
  let n = 0;
  const uc = new ManageExperimentUseCase({
    repository: repo,
    clock: { nowIso: () => now },
    ids: { newId: () => `exp-${++n}` },
  });
  return { repo, uc };
}

test("add: defaults status to planned and requires a name", async () => {
  const { uc } = makeUseCase();
  const exp = await uc.add({ name: "  Sweep  " });
  assert.equal(exp.id, "exp-1");
  assert.equal(exp.name, "Sweep");
  assert.equal(exp.status, "planned");
  assert.equal(exp.startedAt, undefined);
  await assert.rejects(uc.add({ name: "  " }), ExperimentValidationError);
});

test("setStatus: stamps startedAt on first run, finishedAt on a terminal status", async () => {
  const { uc } = makeUseCase("2026-07-23T10:00:00.000Z");
  const created = await uc.add({ name: "Run" });
  const running = await uc.setStatus(created.id, "running");
  assert.equal(running.status, "running");
  assert.equal(running.startedAt, "2026-07-23T10:00:00.000Z");
  const done = await uc.setStatus(created.id, "done");
  assert.equal(done.status, "done");
  assert.equal(done.finishedAt, "2026-07-23T10:00:00.000Z");
  // startedAt is preserved, not overwritten
  assert.equal(done.startedAt, "2026-07-23T10:00:00.000Z");
});

test("recordMetrics: shallow-merges into existing metrics", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ name: "M", metrics: { acc: 0.1 } });
  const a = await uc.recordMetrics(created.id, { loss: 2 });
  assert.deepEqual(a.metrics, { acc: 0.1, loss: 2 });
  const b = await uc.recordMetrics(created.id, { acc: 0.9 });
  assert.deepEqual(b.metrics, { acc: 0.9, loss: 2 });
});

test("setStatus / recordMetrics: throw for an unknown id", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(uc.setStatus("nope", "running"), /No experiment with id/);
  await assert.rejects(uc.recordMetrics("nope", {}), /No experiment with id/);
});

test("remove: deletes the experiment", async () => {
  const { repo, uc } = makeUseCase();
  const created = await uc.add({ name: "Temp" });
  await uc.remove(created.id);
  assert.equal(await repo.getById(created.id), null);
});
