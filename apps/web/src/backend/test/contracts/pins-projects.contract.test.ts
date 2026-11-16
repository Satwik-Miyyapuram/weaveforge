// contract-repos: library_pins, projects
import assert from "node:assert/strict";
import test from "node:test";
import type { ILibraryPinRepository, IProjectManager, IProjectRepository, Project } from "@weaveforge/core";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `ILibraryPinRepository` and `IProjectRepository` contract, end to end:
 * Rust plans each query, the TS sender runs it against PGlite with the real
 * migrations and RLS. Ported from the deleted `library-pin-repository-contract.ts`
 * and `project-repository-contract.ts` suites.
 */

async function pinsFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const repo = rustRepository<ILibraryPinRepository>(
    clientFor(db, userId),
    "library_pins",
    ["pin", "unpin", "listForProject", "isPinned"],
    projectUserCtx(projectFor(projectId), sessionFor(userId)),
  );
  return { repo, userId };
}

async function projectsFor(db: Db) {
  const userId = await db.createUser();
  return rustRepository<IProjectRepository & IProjectManager>(
    clientFor(db, userId),
    "projects",
    ["getById", "list", "save", "delete", "create", "remove"],
    async () => ({ userId }),
  );
}

function sampleProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Thesis",
    color: overrides.color,
    createdAt: overrides.createdAt ?? "2026-06-24T00:00:00.000Z",
  };
}

test("pin then listForProject returns the pin", async () => {
  const { repo, userId } = await pinsFor(await testDb());
  const resourceId = crypto.randomUUID();
  const pin = await repo.pin({ resourceType: "paper", resourceId, ownerId: userId });
  assert.equal(pin.resourceId, resourceId);
  assert.equal(pin.ownerId, userId);
  const list = await repo.listForProject();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.resourceId, resourceId);
});

test("pin is idempotent on the same resource", async () => {
  const { repo, userId } = await pinsFor(await testDb());
  const resourceId = crypto.randomUUID();
  const first = await repo.pin({ resourceType: "paper", resourceId, ownerId: userId });
  const second = await repo.pin({ resourceType: "paper", resourceId, ownerId: userId });
  assert.equal(first.id, second.id);
  assert.equal((await repo.listForProject()).length, 1);
});

test("unpin removes the pin", async () => {
  const { repo, userId } = await pinsFor(await testDb());
  const resourceId = crypto.randomUUID();
  await repo.pin({ resourceType: "paper", resourceId, ownerId: userId });
  await repo.unpin("paper", resourceId);
  assert.equal((await repo.listForProject()).length, 0);
  assert.equal(await repo.isPinned("paper", resourceId), false);
});

test("isPinned reflects pin state", async () => {
  const { repo, userId } = await pinsFor(await testDb());
  const resourceId = crypto.randomUUID();
  assert.equal(await repo.isPinned("paper", resourceId), false);
  await repo.pin({ resourceType: "paper", resourceId, ownerId: userId });
  assert.equal(await repo.isPinned("paper", resourceId), true);
});

test("save then getById returns the entity", async () => {
  const repo = await projectsFor(await testDb());
  const project = sampleProject();
  await repo.save(project);
  const found = await repo.getById(project.id);
  assert.ok(found);
  assert.equal(found.name, project.name);
});

test("getById returns null when absent", async () => {
  const repo = await projectsFor(await testDb());
  assert.equal(await repo.getById(crypto.randomUUID()), null);
});

test("list returns saved projects", async () => {
  const repo = await projectsFor(await testDb());
  await repo.save(sampleProject({ name: "Thesis" }));
  await repo.save(sampleProject({ name: "Side project" }));
  const all = await repo.list();
  assert.equal(all.length, 2);
});

test("delete removes the project", async () => {
  const repo = await projectsFor(await testDb());
  const project = sampleProject();
  await repo.save(project);
  await repo.delete(project.id);
  assert.equal(await repo.getById(project.id), null);
});
