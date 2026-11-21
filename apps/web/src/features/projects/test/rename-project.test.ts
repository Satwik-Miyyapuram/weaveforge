import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { ProjectValidationError, type Project } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import { typedCore } from "@/lib/rust-core";

import { renameProject } from "../application/rename-project";

before(async () => {
  await loadTestCore();
});

const PROJECT: Project = {
  id: "8d731734-bdcd-4f08-b648-efd15fdf75da",
  name: "MSc Thesis",
  color: "#7c9885",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function recorder() {
  const saved: Project[] = [];
  return { saved, save: async (p: Project) => void saved.push(p) };
}

test("a rename saves the trimmed name and keeps everything else", async () => {
  const { saved, save } = recorder();
  const renamed = await renameProject(PROJECT, "  Thesis Final  ", { save, fs: null });
  assert.deepEqual(renamed, { ...PROJECT, name: "Thesis Final" });
  assert.deepEqual(saved, [renamed]);
});

test("a rename carries the project's folder to the new name", async () => {
  const fs = new MemoryWorkspaceFs();
  const oldRoot = typedCore().projectDir(PROJECT);
  await fs.writeFile(`${oldRoot}/notes/a.md`, "hello");
  const { save } = recorder();

  const renamed = await renameProject(PROJECT, "Thesis Final", { save, fs });

  const newRoot = typedCore().projectDir(renamed);
  assert.notEqual(newRoot, oldRoot);
  assert.equal(await fs.readText(`${newRoot}/notes/a.md`), "hello");
  // The old folder is copied, never removed: it stays the reader's copy until they check the new one.
  assert.equal(await fs.readText(`${oldRoot}/notes/a.md`), "hello");
});

test("a project with no folder yet still renames", async () => {
  const { saved, save } = recorder();
  await renameProject(PROJECT, "Thesis Final", { save, fs: new MemoryWorkspaceFs() });
  assert.equal(saved.length, 1);
});

test("a blank name is refused and nothing is saved or moved", async () => {
  const fs = new MemoryWorkspaceFs();
  const oldRoot = typedCore().projectDir(PROJECT);
  await fs.writeFile(`${oldRoot}/notes/a.md`, "hello");
  const { saved, save } = recorder();

  await assert.rejects(() => renameProject(PROJECT, "   ", { save, fs }), ProjectValidationError);
  assert.equal(saved.length, 0);
  assert.equal(await fs.readText(`${oldRoot}/notes/a.md`), "hello");
});

test("the same name is a no-op", async () => {
  const { saved, save } = recorder();
  const same = await renameProject(PROJECT, " MSc Thesis ", { save, fs: null });
  assert.equal(same, PROJECT);
  assert.equal(saved.length, 0);
});

test("a failed save leaves the folder where it was", async () => {
  const fs = new MemoryWorkspaceFs();
  const oldRoot = typedCore().projectDir(PROJECT);
  await fs.writeFile(`${oldRoot}/notes/a.md`, "hello");
  const failure = new Error("offline");

  await assert.rejects(
    () => renameProject(PROJECT, "Thesis Final", { save: async () => Promise.reject(failure), fs }),
    (e) => e === failure,
  );
  assert.equal(await fs.readText(`${oldRoot}/notes/a.md`), "hello");
});

test("a folder that will not move does not undo the saved name", async () => {
  const fs = new MemoryWorkspaceFs();
  const oldRoot = typedCore().projectDir(PROJECT);
  await fs.writeFile(`${oldRoot}/notes/a.md`, "hello");
  fs.rename = async () => {
    throw new Error("locked");
  };
  const { saved, save } = recorder();

  // The next folder sync follows the rename again, so the name stands.
  const renamed = await renameProject(PROJECT, "Thesis Final", { save, fs });
  assert.equal(renamed.name, "Thesis Final");
  assert.equal(saved.length, 1);
});
