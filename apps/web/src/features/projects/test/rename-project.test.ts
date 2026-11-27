import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { ProjectValidationError, type Project } from "@weaveforge/core";

import { FileProjectRepository } from "@/backend/providers/files/file-project-repo";
import { loadTestCore } from "@/lib/test/load-test-core";

import { renameProject } from "../application/rename-project";

before(async () => {
  await loadTestCore();
});

/** 0.9.8: a project is its folder, so the id is the folder name. */
const PROJECT: Project = { id: "MSc Thesis", name: "MSc Thesis", color: "#7c9885", createdAt: "2026-01-01T00:00:00.000Z" };

function withRepo(fs = new MemoryWorkspaceFs()) {
  const repo = new FileProjectRepository(fs);
  return { fs, rename: (p: Project, name: string) => repo.rename(p, name) };
}

test("a rename moves the project's folder and gives it the new name as id", async () => {
  const { fs, rename } = withRepo();
  await fs.writeFile("MSc Thesis/notes/a.md", "hello");
  await fs.writeFile("MSc Thesis/notes/a.md.ink/p1.inkb", "ink");
  await fs.writeFile("Other/notes/b.md", "keep");

  const renamed = await renameProject(PROJECT, "  Thesis Final  ", { rename });

  assert.deepEqual(renamed, { ...PROJECT, id: "Thesis Final", name: "Thesis Final" });
  assert.equal(await fs.readText("Thesis Final/notes/a.md"), "hello");
  assert.equal(await fs.readText("Thesis Final/notes/a.md.ink/p1.inkb"), "ink");
  assert.equal(await fs.stat("MSc Thesis"), null);
  assert.equal(await fs.readText("Other/notes/b.md"), "keep");
});

test("a name already in the workspace is refused and nothing moves", async () => {
  const { fs, rename } = withRepo();
  await fs.writeFile("MSc Thesis/notes/a.md", "old");
  await fs.writeFile("Thesis Final/notes/a.md", "new");
  await assert.rejects(() => renameProject(PROJECT, "Thesis Final", { rename }), ProjectValidationError);
  assert.equal(await fs.readText("MSc Thesis/notes/a.md"), "old");
  assert.equal(await fs.readText("Thesis Final/notes/a.md"), "new");
});

test("a blank name is refused and nothing moves", async () => {
  const { fs, rename } = withRepo();
  await fs.writeFile("MSc Thesis/notes/a.md", "hello");
  await assert.rejects(() => renameProject(PROJECT, "   ", { rename }), ProjectValidationError);
  assert.equal(await fs.readText("MSc Thesis/notes/a.md"), "hello");
});

test("the same name is a no-op", async () => {
  let calls = 0;
  const same = await renameProject(PROJECT, " MSc Thesis ", { rename: async (p) => (calls++, p) });
  assert.equal(same, PROJECT);
  assert.equal(calls, 0);
});

test("a rename tells the caller the old and new folder, so per-folder records follow it", async () => {
  const { fs, rename } = withRepo();
  await fs.mkdirp("MSc Thesis/notes");
  const moves: [string, string][] = [];
  await renameProject(PROJECT, "Thesis Final", { rename, onFolderMoved: async (from, to) => void moves.push([from, to]) });
  assert.deepEqual(moves, [["MSc Thesis", "Thesis Final"]]);
});

test("a rename that keeps the id (no folder move) reports no folder move", async () => {
  const moves: [string, string][] = [];
  await renameProject(PROJECT, "Thesis Final", {
    rename: async (p, name) => ({ ...p, name }),
    onFolderMoved: async (from, to) => void moves.push([from, to]),
  });
  assert.deepEqual(moves, []);
});

test("a failed rename moves nothing and reports nothing", async () => {
  const failure = new Error("locked");
  const moves: [string, string][] = [];
  await assert.rejects(
    () =>
      renameProject(PROJECT, "Thesis Final", {
        rename: async () => Promise.reject(failure),
        onFolderMoved: async (from, to) => void moves.push([from, to]),
      }),
    (e) => e === failure,
  );
  assert.deepEqual(moves, []);
});
