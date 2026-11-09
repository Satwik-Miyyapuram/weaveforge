import { test } from "node:test";
import assert from "node:assert/strict";
import { ManageProjectUseCase } from "@weaveforge/core";
import { InMemoryProjectRepository } from "@weaveforge/core/testing";

const clock = { nowIso: () => "2026-06-24T12:00:00.000Z" };
function seqIds() { let n = 0; return { newId: () => `id-${++n}` }; }

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

test("remove deletes the project", async () => {
  const repo = new InMemoryProjectRepository();
  const uc = new ManageProjectUseCase({ repository: repo, clock, ids: seqIds() });
  const p = await uc.create({ name: "Old" });
  await uc.remove(p.id);
  assert.equal(await repo.getById(p.id), null);
});
