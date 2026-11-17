import assert from "node:assert/strict";
import { test } from "node:test";

import { applyReviewedImport, type ImportSeams } from "../application/workspace-folder";
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
}) {
  const log: string[] = [];
  const store: SyncTableStore = {
    async isEmpty(table) {
      return !(opts.populated && table === "projects");
    },
    async keys() {
      return [];
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
  };
  if (opts.marker) {
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
