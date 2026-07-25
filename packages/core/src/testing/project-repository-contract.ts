import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "../features/projects/domain/project.js";
import type { IProjectRepository } from "../features/projects/domain/project-repository.js";

function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "proj-1",
    name: overrides.name ?? "Thesis",
    color: overrides.color,
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
  };
}

export function runProjectRepositoryContract(
  label: string,
  makeRepo: () => IProjectRepository,
): void {
  test(`[${label}] save then getById returns the entity`, async () => {
    const repo = makeRepo();
    const project = sampleProject();
    await repo.save(project);
    const found = await repo.getById(project.id);
    assert.ok(found);
    assert.equal(found.name, project.name);
  });

  test(`[${label}] getById returns null when absent`, async () => {
    const repo = makeRepo();
    assert.equal(await repo.getById("missing"), null);
  });

  test(`[${label}] list returns saved projects`, async () => {
    const repo = makeRepo();
    await repo.save(sampleProject({ id: "a" }));
    await repo.save(sampleProject({ id: "b", name: "Side project" }));
    const all = await repo.list();
    assert.equal(all.length, 2);
  });

  test(`[${label}] delete removes the project`, async () => {
    const repo = makeRepo();
    await repo.save(sampleProject());
    await repo.delete("proj-1");
    assert.equal(await repo.getById("proj-1"), null);
  });
}
