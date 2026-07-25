import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ManageProjectUseCase,
  ProjectValidationError,
  type Project,
  type IProjectRepository,
} from "../src/index.js";

class InMemoryProjectRepo implements IProjectRepository {
  readonly rows = new Map<string, Project>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(p: Project) {
    this.rows.set(p.id, p);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}

function makeUseCase() {
  const repo = new InMemoryProjectRepo();
  const uc = new ManageProjectUseCase({
    repository: repo,
    clock: { nowIso: () => "2026-07-23T09:00:00.000Z" },
    ids: { newId: () => "proj-1" },
  });
  return { repo, uc };
}

test("create: trims the name, stamps id + createdAt, and persists", async () => {
  const { repo, uc } = makeUseCase();
  const project = await uc.create({ name: "  Thesis  ", color: "#abc" });
  assert.equal(project.id, "proj-1");
  assert.equal(project.name, "Thesis");
  assert.equal(project.color, "#abc");
  assert.equal(project.createdAt, "2026-07-23T09:00:00.000Z");
  assert.deepEqual(await repo.getById("proj-1"), project);
});

test("create: rejects a blank name", async () => {
  const { uc } = makeUseCase();
  await assert.rejects(uc.create({ name: "   " }), ProjectValidationError);
});
