import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { WorkspaceSnapshot } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import type { RustCore } from "@/lib/rust-core";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

import { mirrorWorkspace } from "../application/parts-2";
import { readMirrorBase } from "../application/parts-3";

// H1: a project folder with no manifest (absent or unreadable) gives an empty base. An empty base
// must never read as "the reader has not edited this file". A same-session app edit to an existing
// file must then be held, and the reader's copy kept.

let core: RustCore;
before(async () => {
  core = await loadTestCore();
});

const PROJECT = { id: "8d731734-bdcd-4f08-b648-efd15fdf75da", name: "MSc Thesis" };
const AT = "2026-08-05T00:00:00.000Z";
const EXTERNAL = "Typed into the folder by the reader, not the app.";

const snapshot = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  papers: [], vaultPages: [], readingLists: [], readingListItems: [],
  reportSections: [], experiments: [], milestones: [], logEntries: [],
  relations: [], tags: [], readerAnnotations: [], collectedAt: AT, ...over,
});

const note = (id: string, title: string, body = "") =>
  ({ id, title, body, sortOrder: 0, createdAt: "", updatedAt: "" }) as never;

test("no manifest + in-session app edit to an existing file: the file is held, not overwritten", async () => {
  // Find the path the snapshot writes for this note.
  const probe = new MemoryWorkspaceFs(() => AT);
  const before1 = snapshot({ vaultPages: [note("n1", "Method", "Edited in the app this session.")] });
  await mirrorWorkspace(core, before1, probe, { project: PROJECT });
  const target = Object.keys(probe.toRecord()).find((p) => p.endsWith(".md") && probe.toRecord()[p]?.includes("Edited in the app"));
  assert.ok(target, "the snapshot writes a note file");

  // The folder holds an existing copy with the reader's text, and no manifest at all.
  const folder = new MemoryWorkspaceFs(() => AT);
  await folder.writeFile(target as string, EXTERNAL);
  assert.deepEqual(await readMirrorBase(folder, core.projectDir(PROJECT)), {});

  // This session mirrored the note before, with different content, so the app edit is in-session.
  const seen = { [target as string]: readyCore().digestText("Earlier app text, before the edit.") };
  const result = await mirrorWorkspace(core, before1, folder, {
    project: PROJECT,
    seen,
    base: await readMirrorBase(folder, core.projectDir(PROJECT)),
  });

  assert.equal(folder.toRecord()[target as string], EXTERNAL);
  assert.ok(!result.written.includes(target as string), "the held file is not reported as written");
  assert.ok(result.heldBack.includes(target as string), "the held file is reported as held back");
});
