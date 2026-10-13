import assert from "node:assert/strict";
import test from "node:test";
import type { Paper, ReaderAnnotation } from "@weaveforge/core";
import { InMemoryReaderAnnotationRepository } from "@weaveforge/core/testing";
import {
  annotationsOwedToZotero,
  writeBackZoteroAnnotations,
  zoteroWriteBackMessage,
  type ZoteroAnnotationPusher,
} from "../application/write-back-zotero-annotations";

function ann(over: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "a",
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "t",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    syncState: "local",
    zoteroVersion: null,
    ...over,
  };
}

const paper = (id: string, attachment?: string) =>
  ({ id, title: id, metadata: attachment ? { zoteroAttachmentKey: attachment } : {} }) as unknown as Paper;

test("only new or edited local marks are owed; Zotero's own, synced, conflicted and ink are not", () => {
  const owed = annotationsOwedToZotero([
    ann({ id: "new" }),
    ann({ id: "edited", zoteroKey: "K1", syncState: "pending", zoteroVersion: 3 }),
    ann({ id: "synced", zoteroKey: "K2", syncState: "synced" }),
    ann({ id: "conflict", zoteroKey: "K3", syncState: "conflict" }),
    ann({ id: "from-zotero", origin: "zotero", zoteroKey: "K4" }),
    ann({ id: "ink", type: "ink", anchor: { zoteroPosition: { pageIndex: 0, paths: [[1, 2]] } } }),
    ann({ id: "no-page", anchor: {} }),
  ]);
  assert.deepEqual(owed.map((a) => a.id), ["new", "edited"]);
});

test("a write-back records the Zotero key, so the next sync updates instead of duplicating", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  const created = await repo.create("p1", {
    type: "highlight",
    color: "#ffd400",
    text: "hello",
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
    pageIndex: 0,
  });
  const sent: string[][] = [];
  const pusher: ZoteroAnnotationPusher = {
    push: async (_parent, anns) => {
      sent.push(anns.map((a) => a.id));
      return {
        results: anns.map((a) => ({
          id: a.id,
          outcome: a.zoteroKey ? ("updated" as const) : ("created" as const),
          zoteroKey: a.zoteroKey ?? "ZNEW",
          zoteroVersion: 10,
        })),
      };
    },
  };
  const deps = {
    papers: [paper("p1", "ATT1"), paper("p2")],
    attachmentOf: (p: Paper) => p.metadata?.["zoteroAttachmentKey"] as string | undefined,
    annotations: repo,
    pusher,
  };

  const first = await writeBackZoteroAnnotations(deps);
  assert.equal(first.created, 1);
  const [row] = await repo.list("p1");
  assert.equal(row!.zoteroKey, "ZNEW");
  assert.equal(row!.zoteroVersion, 10);
  assert.equal(row!.syncState, "synced");

  // Nothing changed: nothing is sent again.
  const second = await writeBackZoteroAnnotations(deps);
  assert.deepEqual(second, { created: 0, updated: 0, conflicts: 0, failed: 0 });

  // Edited here: sent as an update under its key.
  await repo.update(created.id, { comment: "now with a comment" });
  const third = await writeBackZoteroAnnotations(deps);
  assert.equal(third.updated, 1);
  assert.deepEqual(sent, [[created.id], [created.id]]);
});

test("failures and conflicts are counted and reported, not swallowed", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  const a = await repo.create("p1", {
    type: "highlight", color: "#ffd400", anchor: { zoteroPosition: { pageIndex: 0 } }, pageIndex: 0,
  });
  const b = await repo.create("p1", {
    type: "underline", color: "#ffd400", anchor: { zoteroPosition: { pageIndex: 1 } }, pageIndex: 1,
  });
  const summary = await writeBackZoteroAnnotations({
    papers: [paper("p1", "ATT1")],
    attachmentOf: () => "ATT1",
    annotations: repo,
    pusher: {
      push: async () => ({
        results: [
          { id: a.id, outcome: "failed", reason: "Zotero create failed (403)." },
          { id: b.id, outcome: "conflict", zoteroKey: "ZB" },
        ],
      }),
    },
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.conflicts, 1);
  assert.equal((await repo.list("p1")).find((r) => r.id === b.id)!.syncState, "conflict");
  assert.match(zoteroWriteBackMessage(summary), /could not be sent \(Zotero create failed \(403\)\.\)/);
});

test("a thrown push (no network) fails that paper's marks and carries on", async () => {
  const repo = new InMemoryReaderAnnotationRepository();
  await repo.create("p1", { type: "highlight", color: "#ffd400", anchor: { zoteroPosition: { pageIndex: 0 } }, pageIndex: 0 });
  const summary = await writeBackZoteroAnnotations({
    papers: [paper("p1", "ATT1")],
    attachmentOf: () => "ATT1",
    annotations: repo,
    pusher: { push: async () => { throw new Error("offline"); } },
  });
  assert.deepEqual(summary, { created: 0, updated: 0, conflicts: 0, failed: 1, firstError: "offline" });
  assert.equal(zoteroWriteBackMessage(null), "");
  assert.equal(zoteroWriteBackMessage({ created: 2, updated: 1, conflicts: 0, failed: 0 }), " · sent 3 annotations to Zotero");
});
