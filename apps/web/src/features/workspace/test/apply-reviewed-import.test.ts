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
 * stopped partway leaves a marker, and the next Apply resumes it.
 *
 * Every seam is a fake that records into one log, so the order is what is asserted.
 */
function harness(opts: {
  populated: boolean;
  folderTables: Partial<Record<SyncTable, SyncRow[]>> | null;
  marker?: { pending: boolean; failOn?: SyncTable };
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
      if (table === opts.marker?.failOn) throw new Error("connection dropped");
      log.push(`insert:${table}`);
    },
  };
  const reviewed = { entries: [], counts: {}, json: { marker: true } };
  const resolutions = { "notes/a.note.md": "folder" };
  const seams: ImportSeams = {
    store,
    folderTables: async () => opts.folderTables,
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
  };
  if (opts.restoreMarker) {
    seams.restoreMarker = opts.restoreMarker;
  } else if (opts.marker) {
    let pending = opts.marker.pending;
    seams.restoreMarker = {
      async isPending() {
        return pending;
      },
      async set() {
        log.push("marker:set");
        pending = true;
      },
      async clear() {
        log.push("marker:clear");
        pending = false;
      },
    };
  }
  return { log, reviewed, resolutions, seams };
}

test("an empty workspace restores the folder's tables before the apply", async () => {
  const h = harness({ populated: false, folderTables: { projects: [{ id: "p1" }] } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.equal(h.log[0], "insert:projects", "restore writes first");
  assert.ok(h.log.indexOf("preview") > h.log.indexOf("insert:projects"), "preview after restore");
  assert.equal(h.log.at(-1), 'apply:json=none:picks={"notes/a.note.md":"folder"}', "apply last, with no JSON");
});

test("a populated workspace keeps the plain apply with the reviewed diff", async () => {
  const h = harness({ populated: true, folderTables: { projects: [{ id: "p1" }] } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, ['apply:json=present:picks={"notes/a.note.md":"folder"}']);
});

test("an empty workspace with no table files in the folder is the plain apply", async () => {
  const h = harness({ populated: false, folderTables: null });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, ['apply:json=present:picks={"notes/a.note.md":"folder"}']);
});

test("a populated workspace with no restore marker never sets one and keeps the plain apply", async () => {
  const h = harness({ populated: true, folderTables: { projects: [{ id: "p1" }] }, marker: { pending: false } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, ['apply:json=present:picks={"notes/a.note.md":"folder"}']);
});

test("a pending restore marker resumes the restore even though the workspace has rows", async () => {
  const h = harness({ populated: true, folderTables: { projects: [{ id: "p1" }] }, marker: { pending: true } });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [
    "marker:set",
    "insert:projects",
    "preview",
    'apply:json=none:picks={"notes/a.note.md":"folder"}',
    "marker:clear",
  ]);
});

test("a restore that fails leaves the marker set, so the next Apply resumes it", async () => {
  const h = harness({
    populated: false,
    folderTables: { projects: [{ id: "p1" }] },
    marker: { pending: false, failOn: "projects" },
  });
  await assert.rejects(applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams), /connection dropped/);
  assert.equal(h.log.includes("marker:clear"), false, "the marker is not cleared after a failed restore");
  assert.equal(h.log[0], "marker:set");
});

test("a resumed restore names the stored rows it kept because they differ from the folder", async () => {
  const h = harness({
    populated: true,
    folderTables: { projects: [{ id: "p1", name: "Folder name" }] },
    marker: { pending: true },
    stored: { projects: [{ id: "p1", name: "Renamed locally" }] },
  });
  await applyReviewedImport(h.reviewed as never, h.resolutions as never, h.seams);
  assert.deepEqual(h.log, [
    "marker:set",
    'conflicts:[{"table":"projects","key":{"id":"p1"}}]',
    "preview",
    'apply:json=none:picks={"notes/a.note.md":"folder"}',
    "marker:clear",
  ]);
});

test("a failed restore resumes after the user switches project", async () => {
  // The marker lives at the workspace root, so it is the same file whichever project is active.
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
    populated: false,
    folderTables: { projects: [{ id: "p1" }] },
    marker: { pending: false, failOn: "projects" },
    restoreMarker: marker,
  });
  await assert.rejects(applyReviewedImport(first.reviewed as never, first.resolutions as never, first.seams), /connection dropped/);
  assert.deepEqual([...files.keys()], [".weaveforge/restore-pending.json"], "the marker is written at the workspace root");

  // The user switches to another project: the database holds the failed restore's rows, and
  // the folder read is the other project's. The marker still says a restore is pending.
  const second = harness({
    populated: true,
    folderTables: { projects: [{ id: "p2" }] },
    restoreMarker: marker,
  });
  await applyReviewedImport(second.reviewed as never, second.resolutions as never, second.seams);
  assert.deepEqual(second.log, [
    "insert:projects",
    "preview",
    'apply:json=none:picks={"notes/a.note.md":"folder"}',
  ]);
  assert.equal(files.size, 0, "the resumed restore clears the marker");
});
