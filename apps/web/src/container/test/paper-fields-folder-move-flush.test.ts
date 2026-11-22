import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { PaperFieldDef } from "@weaveforge/core";

import { FilePaperFieldRepository } from "@/backend/providers/files/file-paper-field-repo";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";

const DEF: PaperFieldDef = { id: "f-venue", name: "Venue", kind: "text", options: [], sortOrder: 0 };

test("a folder move resolves only after the settings write has landed", async () => {
  const fs = new MemoryWorkspaceFs();
  const memory = new MemorySettings();
  const landed: string[] = [];
  const settings = {
    get: (key: readonly string[]) => memory.get(key),
    set: (key: readonly string[], value: unknown) => memory.set(key, value),
    flush: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      landed.push("written");
    },
  };
  const repo = new FilePaperFieldRepository(new FilePaperRepository(fs, ""), settings, fs, () => "/old");
  await repo.saveDef(DEF);

  await repo.moveProjectFolder("/old", "/new");
  assert.deepEqual(landed, ["written"], "the move returned before the settings write landed");
});
