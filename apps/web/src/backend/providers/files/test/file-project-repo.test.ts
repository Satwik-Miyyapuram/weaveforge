import { before, test } from "node:test";
import assert from "node:assert/strict";
import { ProjectValidationError } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { loadTestCore } from "@/lib/test/load-test-core";
import { FileProjectRepository } from "../file-project-repo";

before(loadTestCore);

function setup() {
  const fs = new MemoryWorkspaceFs();
  return { fs, repo: new FileProjectRepository(fs) };
}

test("create then getById and list return the same project", async () => {
  const { repo } = setup();
  const created = await repo.create({ name: "Thesis", color: "#336699" });
  assert.deepEqual(await repo.getById(created.id), created);
  assert.deepEqual(await repo.list(), [created]);
});

test("getById of another id is null; empty workspace lists nothing", async () => {
  const { repo } = setup();
  assert.deepEqual(await repo.list(), []);
  await repo.create({ name: "Thesis" });
  assert.equal(await repo.getById("nope"), null);
});

test("the project is written to .weaveforge/workspace.json", async () => {
  const { fs, repo } = setup();
  const created = await repo.create({ name: "Thesis" });
  const stored = JSON.parse(await fs.readText(".weaveforge/workspace.json")) as { id: string; name: string };
  assert.equal(stored.id, created.id);
  assert.equal(stored.name, "Thesis");
});

test("saving keeps other keys already in workspace.json", async () => {
  const { fs, repo } = setup();
  const created = await repo.create({ name: "Thesis" });
  const stored = JSON.parse(await fs.readText(".weaveforge/workspace.json")) as Record<string, unknown>;
  await fs.writeFile(".weaveforge/workspace.json", JSON.stringify({ ...stored, sharedKey: "kept" }));
  await repo.save({ ...created, name: "Dissertation" });
  const after = JSON.parse(await fs.readText(".weaveforge/workspace.json")) as Record<string, unknown>;
  assert.equal(after.sharedKey, "kept");
  assert.equal(after.name, "Dissertation");
});

test("save renames the project and keeps its id", async () => {
  const { repo } = setup();
  const created = await repo.create({ name: "Thesis" });
  await repo.save({ ...created, name: "Dissertation" });
  const renamed = await repo.getById(created.id);
  assert.equal(renamed?.name, "Dissertation");
  assert.equal(renamed?.createdAt, created.createdAt);
});

test("delete removes the workspace file so the project is gone", async () => {
  const { repo } = setup();
  const created = await repo.create({ name: "Thesis" });
  await repo.delete(created.id);
  assert.equal(await repo.getById(created.id), null);
  assert.deepEqual(await repo.list(), []);
});

test("a blank name is rejected with ProjectValidationError", async () => {
  const { repo } = setup();
  await assert.rejects(repo.create({ name: "   " }), ProjectValidationError);
  assert.deepEqual(await repo.list(), []);
});
