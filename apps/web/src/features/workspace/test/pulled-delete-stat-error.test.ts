import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { keepMirrorBases, PULLED_DELETES_PATH, readMirrorBase, writeMirrorManifest } from "../application/parts-3";

// A mirrored file is recorded as a pulled delete only when it is really gone. A
// stat that fails for another reason (permission denied, say) proves nothing about
// the file, so it must not be recorded: the mirror would then leave the file out.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

/** A folder whose `stat` can be made to fail with a permission error for every path. */
class DeniedStatFs extends MemoryWorkspaceFs {
  denied = false;
  override async stat(path: string) {
    if (this.denied) throw Object.assign(new Error(`EACCES: permission denied, stat '${path}'`), { code: "EACCES" });
    return super.stat(path);
  }
}

test("a mirrored file whose stat fails for a reason other than missing is not recorded as a pulled delete", async () => {
  const folder = new DeniedStatFs(() => AT);
  const root = core.projectDir(PROJECT);
  const input = snapshot({ vaultPages: [note("n1", "Method", "Kept.")] });
  const base = await readMirrorBase(folder, root);
  const mirrored = await mirrorWorkspace(core, input, folder, { project: PROJECT, base });
  await writeMirrorManifest(folder, root, Object.keys(mirrored.mirrored), mirrored.mirrored);
  const notePath = Object.keys(mirrored.mirrored).find((p) => p.endsWith("/notes/method.note.md"));
  assert.ok(notePath, "the note was mirrored");

  await keepMirrorBases(
    folder,
    async () => {
      folder.denied = true;
      return { pull: { kind: "fast-forward" } };
    },
    (reply) => reply.pull.kind === "fast-forward",
  );

  folder.denied = false;
  assert.equal(folder.toRecord()[PULLED_DELETES_PATH], undefined, "a stat error is not a delete");
});
