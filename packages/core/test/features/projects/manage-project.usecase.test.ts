import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryProjectRepository } from "../../../src/testing/in-memory-project-repository.js";
import { ManageProjectUseCase } from "../../../src/features/projects/application/manage-project.use-case.js";
import type {IdGenerator} from "../../../src/shared/clock.js";
import { fixedClock, seqIds } from "../../../src/testing/fakes.js";

const clock = fixedClock("2026-06-24T12:00:00.000Z");
function seqIds(): IdGenerator { let n = 0; return { newId: () => `id-${++n}` }; }

test("create persists a named project", async () => {
  const repo = new InMemoryProjectRepository();
  const uc = new ManageProjectUseCase({ repository: repo, clock, ids: seqIds() });
  const p = await uc.create({ name: "Latent Spaces Thesis" });
  assert.equal((await repo.getById(p.id))?.name, "Latent Spaces Thesis");
});

test("create rejects empty name", async () => {
  const repo = new InMemoryProjectRepository();
  const uc = new ManageProjectUseCase({ repository: repo, clock, ids: seqIds() });
  await assert.rejects(() => uc.create({ name: "  " }));
});
