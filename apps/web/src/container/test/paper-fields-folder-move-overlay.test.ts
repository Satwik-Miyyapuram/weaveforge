import assert from "node:assert/strict";
import { before, test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { IPaperFieldRepository, ManagePaperFieldsUseCase, PaperFieldDef, Project } from "@weaveforge/core";

import { wireFileBackend } from "@/backend/providers/files/wire-file-backend";
import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import { renameProject } from "@/features/projects/application/rename-project";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { PaperFieldsFacade } from "../facades/paper-fields";
import { overlayFileRepositories } from "../with-file-repositories";

before(loadTestCore);

// Integration: the files overlay supplies the folder move to the paper-field
// repository, and create-app-container's wiring (bind the overlay's method into
// the facade, pass the facade to renameProject) re-tags the definitions.
const PROJECT: Project = {
  id: "8d731734-bdcd-4f08-b648-efd15fdf75da",
  name: "MSc Thesis",
  color: "#7c9885",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const DEF: PaperFieldDef = { id: "f-venue", name: "Venue", kind: "text", options: [], sortOrder: 0 };

test("a project rename through the files overlay re-tags its field definitions", async () => {
  const fs = new MemoryWorkspaceFs();
  const settings = new MemorySettings();
  const oldRoot = typedCore().projectDir(PROJECT);
  const fieldRepo = new FilePaperFieldRepository(new FilePaperRepository(fs, ""), settings, fs, () => oldRoot);
  await fieldRepo.saveDef(DEF);

  const files = wireFileBackend({ fs, settings, secrets: {} as never });
  const backend = overlayFileRepositories(
    { paperFieldRepository: {} as IPaperFieldRepository },
    { ...files, paperFieldRepository: fieldRepo },
  );
  const facade = new PaperFieldsFacade({
    paperFields: {} as ManagePaperFieldsUseCase,
    moveProjectFolder: backend.paperFieldRepository.moveProjectFolder?.bind(backend.paperFieldRepository),
  });

  const renamed = await renameProject(PROJECT, "Thesis Final", {
    save: async () => undefined,
    fs,
    onFolderMoved: (from, to) => facade.moveProjectFolder(from, to),
  });

  const newRoot = typedCore().projectDir(renamed);
  assert.equal(settings.get(["paperFields", DEF.id, "projectId"]), newRoot);
  const projectIds = Object.values(settings.get(["paperFields"]) as Record<string, { projectId: string }>).map(
    (d) => d.projectId,
  );
  assert.equal(projectIds.includes(oldRoot), false);
});
