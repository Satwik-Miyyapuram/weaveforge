import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageMilestoneUseCase,
  MilestoneValidationError,
  type Milestone,
  type IMilestoneRepository,
} from "../../../src/index.js";

class InMemoryMilestoneRepo implements IMilestoneRepository {
  readonly rows = new Map<string, Milestone>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(m: Milestone) {
    this.rows.set(m.id, m);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

function makeUseCase() {
  const repo = new InMemoryMilestoneRepo();
  let n = 0;
  const uc = new ManageMilestoneUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => `ms-${++n}` },
  });
  return { repo, uc };
}

test("add: defaults status to planned, requires a title, validates targetDate", async () => {
  const { uc } = makeUseCase();
  const ms = await uc.add({ title: "  Draft intro  " });
  assert.equal(ms.title, "Draft intro");
  assert.equal(ms.status, "planned");
  await assert.rejects(uc.add({ title: " " }), MilestoneValidationError);
  await assert.rejects(uc.add({ title: "x", targetDate: "07/2026" }), /yyyy-mm-dd/);
});

test("setStatus: updates status", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ title: "T" });
  const blocked = await uc.setStatus(created.id, "blocked");
  assert.equal(blocked.status, "blocked");
});

test("update: edits fields, preserves id/createdAt, clears targetDate on empty string", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ title: "Old", targetDate: "2026-08-01" });
  const updated = await uc.update(created.id, { title: "  New  ", status: "in_progress" });
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.title, "New");
  assert.equal(updated.status, "in_progress");
  assert.equal(updated.targetDate, "2026-08-01");
  const cleared = await uc.update(created.id, { targetDate: "" });
  assert.equal(cleared.targetDate, undefined);
});

test("update: rejects blank title and bad targetDate", async () => {
  const { uc } = makeUseCase();
  const created = await uc.add({ title: "Keep" });
  await assert.rejects(uc.update(created.id, { title: "   " }), /title is required/);
  await assert.rejects(uc.update(created.id, { targetDate: "nope" }), /yyyy-mm-dd/);
});

test("update / remove: update throws for unknown id; remove deletes", async () => {
  const { repo, uc } = makeUseCase();
  await assert.rejects(uc.update("nope", { title: "x" }), /No milestone with id/);
  const created = await uc.add({ title: "Temp" });
  await uc.remove(created.id);
  assert.equal(await repo.getById(created.id), null);
});
