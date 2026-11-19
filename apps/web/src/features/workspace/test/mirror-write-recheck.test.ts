import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";

// The plan reads each file it may write, then the writes follow. A file that
// appears in between (a reader, git pull, or another app) must not be overwritten
// by the plan's stale decision: the mirror re-reads the file before writing it and
// skips it when it no longer matches what the plan read.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const RIVAL = "Written by someone else after the plan read the folder.";

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

const local = snapshot({ vaultPages: [note("n1", "Method", "What this machine last wrote.")] });

/** Makes `target` appear with RIVAL text right after the plan's first failed read of it. */
class AppearingFs extends MemoryWorkspaceFs {
  private raced = false;
  constructor(private readonly target: string) {
    super(() => AT);
  }
  override async readText(path: string): Promise<string> {
    try {
      return await super.readText(path);
    } catch (error) {
      if (path === this.target && !this.raced) {
        this.raced = true;
        await super.writeFile(path, RIVAL);
      }
      throw error;
    }
  }
}

test("a file that appears after the plan read is not overwritten by the mirror", async () => {
  const probe = new MemoryWorkspaceFs(() => AT);
  await mirrorWorkspace(core, local, probe, { project: PROJECT });
  const target = Object.keys(probe.toRecord()).find((p) => p.endsWith(".md") && probe.toRecord()[p]?.includes("What this machine"));
  assert.ok(target, "the snapshot writes a note file");

  const folder = new AppearingFs(target as string);
  const result = await mirrorWorkspace(core, local, folder, { project: PROJECT });

  assert.equal(folder.toRecord()[target as string], RIVAL);
  assert.ok(!result.written.includes(target as string), "the skipped file is not reported as written");
});
