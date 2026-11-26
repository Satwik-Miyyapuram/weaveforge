import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { ManagePaperFieldsUseCase, PaperFieldDef, Project } from "@weaveforge/core";

import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { renameProject } from "@/features/projects/application/rename-project";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { PaperFieldsFacade } from "../facades/paper-fields";

before(loadTestCore);

const PROJECT: Project = {
  id: "8d731734-bdcd-4f08-b648-efd15fdf75da",
  name: "MSc Thesis",
  color: "#7c9885",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const DEF: PaperFieldDef = { id: "f-venue", name: "Venue", kind: "text", options: [], sortOrder: 0 };

test("renaming a project keeps its field definitions under the new projectId, none under the old", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = new MemorySettings();
  const oldRoot = typedCore().projectDir(PROJECT);
  const papers = new FilePaperRepository(fs, "");
  const repo = new FilePaperFieldRepository(papers, settings, fs, () => oldRoot);
  await repo.saveDef(DEF);

  const facade = new PaperFieldsFacade({
    paperFields: {} as ManagePaperFieldsUseCase,
    moveProjectFolder: (from, to) => repo.moveProjectFolder(from, to),
  });
  const renamed = await renameProject(PROJECT, "Thesis Final", {
    save: async () => undefined,
    fs,
    onFolderMoved: (from, to) => facade.moveProjectFolder(from, to),
  });

  const newRoot = typedCore().projectDir(renamed);
  assert.notEqual(newRoot, oldRoot);
  assert.equal(settings.get(["paperFields", DEF.id, "projectId"]), newRoot);
  const projectIds = Object.values(settings.get(["paperFields"]) as Record<string, { projectId: string }>).map((d) => d.projectId);
  assert.equal(projectIds.includes(oldRoot), false);
});
