import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideAnnotationSync,
  diffAnnotationFields,
  DryRunZoteroAnnotationWriteBack,
  isAnnotationSyncState,
  isZoteroLibrarySyncMode,
  resolveAnnotationConflict,
  toZoteroWritePayload,
  type AnnotationSyncRow,
} from "../src/reader/zotero-write-back.js";
import type { ReaderAnnotation } from "../src/reader/reader-annotation.js";

function baseLocal(over: Partial<ReaderAnnotation> = {}): ReaderAnnotation {
  return {
    id: "local-1",
    origin: "local",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "hello",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } },
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function row(partial: Partial<AnnotationSyncRow> & Pick<AnnotationSyncRow, "local">): AnnotationSyncRow {
  return {
    remote: null,
    ...partial,
  };
}

test("isAnnotationSyncState / isZoteroLibrarySyncMode", () => {
  assert.equal(isAnnotationSyncState("pending"), true);
  assert.equal(isAnnotationSyncState("nope"), false);
  assert.equal(isZoteroLibrarySyncMode("bidirectional"), true);
  assert.equal(isZoteroLibrarySyncMode("write"), false);
});

test("decideAnnotationSync pushes local-only in bidirectional", () => {
  const decision = decideAnnotationSync(
    row({
      local: { ...baseLocal(), syncState: "local", zoteroVersion: null },
    }),
    "bidirectional",
  );
  assert.equal(decision.kind, "push");
});

test("decideAnnotationSync skips push in read_only / ignored", () => {
  const localOnly = row({
    local: { ...baseLocal(), syncState: "local", zoteroVersion: null },
  });
  assert.equal(decideAnnotationSync(localOnly, "read_only").kind, "skip");
  assert.equal(decideAnnotationSync(localOnly, "ignored").kind, "skip");
});

test("decideAnnotationSync conflicts when same version diverges", () => {
  const local = {
    ...baseLocal({ color: "#ff6666", zoteroKey: "ABCD" }),
    syncState: "pending" as const,
    zoteroVersion: 3,
  };
  const decision = decideAnnotationSync(
    {
      local,
      remote: {
        key: "ABCD",
        version: 3,
        type: "highlight",
        color: "#ffd400",
        text: "hello",
        comment: "",
        tags: [],
        anchor: local.anchor,
        sortIndex: local.sortIndex,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    },
    "bidirectional",
  );
  assert.equal(decision.kind, "conflict");
  if (decision.kind === "conflict") {
    assert.ok(decision.fields.some((f) => f.field === "color"));
  }
});

test("decideAnnotationSync pulls when remote ahead and local clean", () => {
  const local = {
    ...baseLocal({ zoteroKey: "ABCD" }),
    syncState: "synced" as const,
    zoteroVersion: 2,
  };
  const decision = decideAnnotationSync(
    {
      local,
      remote: {
        key: "ABCD",
        version: 4,
        type: "highlight",
        color: "#2ea8e5",
        text: "hello",
        comment: "remote",
        tags: [],
        anchor: local.anchor,
        sortIndex: local.sortIndex,
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    },
    "bidirectional",
  );
  assert.equal(decision.kind, "pull");
});

test("diffAnnotationFields and resolveAnnotationConflict", () => {
  const local = {
    ...baseLocal({ comment: "mine", color: "#ffd400", zoteroKey: "K" }),
    syncState: "conflict" as const,
    zoteroVersion: 1,
  };
  const syncRow: AnnotationSyncRow = {
    local,
    remote: {
      key: "K",
      version: 2,
      type: "highlight",
      color: "#ff6666",
      text: "hello",
      comment: "theirs",
      tags: ["a"],
      anchor: local.anchor,
      sortIndex: local.sortIndex,
      updatedAt: "2026-01-04T00:00:00.000Z",
    },
  };
  assert.ok(diffAnnotationFields(syncRow).length >= 2);
  const kept = resolveAnnotationConflict(syncRow, "keep_local");
  assert.equal(kept!.comment, "mine");
  const accepted = resolveAnnotationConflict(syncRow, "accept_remote");
  assert.equal(accepted!.color, "#ff6666");
  assert.equal(accepted!.comment, "theirs");
  const merged = resolveAnnotationConflict(syncRow, "merge");
  assert.equal(merged!.color, "#ff6666");
  assert.equal(merged!.comment, "mine");
});

test("DryRunZoteroAnnotationWriteBack never goes live", async () => {
  const client = new DryRunZoteroAnnotationWriteBack();
  const result = await client.push("PARENT", [baseLocal()]);
  assert.equal(result.dryRun, true);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0]!.parentItem, "PARENT");
  assert.deepEqual(toZoteroWritePayload(baseLocal(), "P").tags, []);
  await assert.rejects(() => client.push("PARENT", [baseLocal()], { live: true }), /Live Zotero/);
});
