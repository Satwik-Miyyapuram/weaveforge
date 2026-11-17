import assert from "node:assert/strict";
import { test } from "node:test";

import type { IWorkspaceFs } from "@weaveforge/core";

import { applyReviewedImport, type ImportSeams } from "../application/workspace-folder";
import { folderRestoreMarker } from "../application/workspace-folder-apply";
import type { RestoreMarker } from "../application/workspace-folder-tables";
import type { SyncRow, SyncTable, SyncTableStore } from "../application/sync-tables";

/**
 * The Apply button's branch. An empty workspace with table files in the folder restores
 * the tables first; anything else is the plain folder apply, unchanged. A restore that
 * stopped partway leaves a marker that names the project it belongs to. The next Apply
 * resumes it only in that project; in any other project it skips the restore and says so.
 *
 * Every seam is a fake that records into one log, so the order is what is asserted.
 */
function harness(opts: {
  project?: string;
  populated: boolean;
  folderTables: Partial<Record<SyncTable, SyncRow[]>> | null;
  marker?: { pendingFor: string | null };
  failOn?: SyncTable;
  restoreMarker?: RestoreMarker;
  stored?: Partial<Record<SyncTable, SyncRow[]>>;
}) {
  const log: string[] = [];
  const store: SyncTableStore = {
    async isEmpty(table) {
      return !(opts.populated && table === "projects");
    },
    async rows(table) {
      return opts.stored?.[table] ?? [];
    },
    async insert(table) {
      if (table === opts.failOn) throw new Error("connection dropped");
      log.push(`insert:${table}`);
    },
  };
  const reviewed = { entries: [], counts: {}, json: { marker: true } };
  const resolutions = { "notes/a.note.md": "folder" };
  const seams: ImportSeams = {
    store,
    folderTables: async () => opts.folderTables,
    activeProjectId: async () => opts.project ?? "proj-a",
    preview: async () => {
      log.push("preview");
      return { entries: [], counts: {}, json: { marker: true } } as never;
    },
    apply: async (diff, picks) => {
      log.push(`apply:json=${diff.json === undefined ? "none" : "present"}:picks=${JSON.stringify(picks)}`);
      return { created: 0, updated: 0 } as never;
    },
    onRestoreConflicts: (conflicts) => {
      log.push(`conflicts:${JSON.stringify(conflicts)}`);
    },
    onRestoreSkipped: (message) => {
      log.push(`skipped:${message}`);
    },
  };
  if (opts.restoreMarker) {
    seams.restoreMarker = opts.restoreMarker;
  } else if (opts.marker) {
    let pendingFor = opts.marker.pendingFor;
    seams.restoreMarker = {
      async pendingFor() {
        return pendingFor;
      },
      async set(projectId) {
        log.push(`marker:set:${projectId}`);
        pendingFor = projectId;
      },
      async clear() {
        log.push("marker:clear");
        pendingFor = null;
      },
    };
  }
  return { log, reviewed, resolutions, seams };
}

const PLAIN_APPLY = 'apply:json=present:picks={"notes/a.note.md":"folder"}';
const RESTORED_APPLY = 'apply:json=none:picks={"notes/a.note.md":"folder"}';

test("an empty workspace restores the folder's tables before the apply", async () => {
  const h = harness({ populated: false, folderTables: { projects: [{ id: "p1" }] } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.equal(h.log[0], "insert:projects", "restore writes first");
  assert.ok(h.log.indexOf("preview") > h.log.indexOf("insert:projects"), "preview after restore");
  assert.equal(h.log.at(-1), RESTORED_APPLY, "apply last, with no JSON");
});

test("a populated workspace keeps the plain apply with the reviewed diff", async () => {
  const h = harness({ populated: true, folderTables: { projects: [{ id: "p1" }] } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [PLAIN_APPLY]);
});

test("an empty workspace with no table files in the folder is the plain apply", async () => {
  const h = harness({ populated: false, folderTables: null });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [PLAIN_APPLY]);
});

test("a populated workspace with no restore marker never sets one and keeps the plain apply", async () => {
  const h = harness({ populated: true, folderTables: { projects: [{ id: "p1" }] }, marker: { pendingFor: null } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [PLAIN_APPLY]);
});

test("a pending restore marker for the active project resumes the restore", async () => {
  const h = harness({
    project: "proj-a",
    populated: true,
    folderTables: { projects: [{ id: "p1" }] },
    marker: { pendingFor: "proj-a" },
  });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [
    "marker:set:proj-a",
    "insert:projects",
    "preview",
    RESTORED_APPLY,
    "marker:clear",
  ]);
});

test("a restore that fails leaves the marker set, so the next Apply resumes it", async () => {
  const h = harness({
    populated: false,
    folderTables: { projects: [{ id: "p1" }] },
    marker: { pendingFor: null },
    failOn: "projects",
  });
  await assert.rejects(applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams), /connection dropped/);
  assert.equal(h.log.includes("marker:clear"), false, "the marker is not cleared after a failed restore");
  assert.equal(h.log[0], "marker:set:proj-a", "the marker names the project being restored");
});

test("a resumed restore names the stored rows it kept because they differ from the folder", async () => {
  const h = harness({
    populated: true,
    folderTables: { projects: [{ id: "p1", name: "Folder name" }] },
    marker: { pendingFor: "proj-a" },
    stored: { projects: [{ id: "p1", name: "Renamed locally" }] },
  });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [
    "marker:set:proj-a",
    'conflicts:[{"table":"projects","key":{"id":"p1"}}]',
    "preview",
    RESTORED_APPLY,
    "marker:clear",
  ]);
});

test("a pending marker for another project skips the restore with a message and keeps the marker", async () => {
  const h = harness({
    project: "proj-b",
    populated: true,
    folderTables: { projects: [{ id: "p2" }] },
    marker: { pendingFor: "proj-a" },
  });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.equal(h.log.length, 2, "one skip message, then the plain apply");
  assert.match(h.log[0] ?? "", /^skipped:.*proj-a/, "the message names the project the restore belongs to");
  assert.equal(h.log[1], PLAIN_APPLY, "the folder apply still runs, with its JSON");
  assert.equal(h.log.some((l) => l.startsWith("insert:")), false, "nothing is restored");
  assert.equal(h.log.includes("marker:clear"), false, "the marker is kept for its own project");
});

test("a resumed restore that the database refuses clears the marker and surfaces the refusal", async () => {
  const h = harness({
    project: "proj-a",
    populated: true,
    folderTables: { projects: [{ id: "p1" }] },
    marker: { pendingFor: "proj-a" },
    stored: { projects: [{ id: "local-only" }] },
  });
  await assert.rejects(
    applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams),
    /Cannot restore: projects already has rows/,
  );
  assert.equal(h.log.at(-1), "marker:clear", "the marker is cleared so Apply stops retrying");
  assert.equal(h.log.some((l) => l.startsWith("apply:")), false, "no apply runs after the refusal");
});

test("a failed restore resumes after the user switches project back, and not in the other project", async () => {
  // The marker is a file at the workspace root, but it records which project it belongs to.
  const files = new Map<string, string>();
  const fs = {
    async readText(path: string) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    async writeFile(path: string, text: string) {
      files.set(path, text);
    },
    async remove(path: string) {
      files.delete(path);
    },
  } as unknown as IWorkspaceFs;
  const marker = folderRestoreMarker(() => fs);

  const first = harness({
    project: "proj-a",
    populated: false,
    folderTables: { projects: [{ id: "p1" }] },
    failOn: "projects",
    restoreMarker: marker,
  });
  await assert.rejects(applyReviewedImport(first.reviewed as never, first.resolutions as never, first.seams), /connection dropped/);
  assert.deepEqual([...files.keys()], [".weaveforge/restore-pending.json"], "the marker is written at the workspace root");
  assert.match(files.get(".weaveforge/restore-pending.json") ?? "", /proj-a/, "the marker names proj-a");

  // The user switches to proj-b. Its folder tables are not proj-a's, so the restore is skipped
  // and the marker stays for proj-a.
  const other = harness({
    project: "proj-b",
    populated: true,
    folderTables: { projects: [{ id: "p2" }] },
    stored: { projects: [{ id: "p1" }] },
    restoreMarker: marker,
  });
  await applyReviewedImport(other.reviewed as never, other.resolutions as never, other.seams);
  assert.match(other.log[0] ?? "", /^skipped:/, "proj-b is told the restore is skipped");
  assert.equal(other.log[1], PLAIN_APPLY, "proj-b gets the plain apply");
  assert.equal(files.size, 1, "the marker is kept for proj-a");

  // Switching back to proj-a resumes the restore and clears the marker.
  const back = harness({
    project: "proj-a",
    populated: true,
    folderTables: { projects: [{ id: "p1" }] },
    stored: { projects: [{ id: "p1" }] },
    restoreMarker: marker,
  });
  await applyReviewedImport(back.reviewed as never, back.resolutions as never, back.seams);
  assert.deepEqual(back.log, ["preview", RESTORED_APPLY], "the restore finds nothing to insert and applies");
  assert.equal(files.size, 0, "the resumed restore clears the marker");
});
