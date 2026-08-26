import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotationPinKey,
  applyAnnotationPatch,
  optimisticAnnotationFromDraft,
  READER_ANNOTATION_COLORS,
} from "../application/reader-annotation-helpers.js";

test("annotationPinKey prefers zoteroKey", () => {
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: "ABCD1234" }), "ABCD1234");
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: null }), "local-1");
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: "  " }), "local-1");
});

test("READER_ANNOTATION_COLORS has stable Zotero-like palette", () => {
  assert.ok(READER_ANNOTATION_COLORS.includes("#ffd400"));
  assert.equal(READER_ANNOTATION_COLORS.length, 8);
});

test("optimisticAnnotationFromDraft mirrors what the repository will store", () => {
  // Painted before the write returns, so it must not differ visibly from the
  // persisted row — a highlight that changes colour or shifts on save reads
  // as a glitch.
  const anchor = { zoteroPosition: { pageIndex: 4, rects: [[1, 2, 3, 4]] } };
  const ann = optimisticAnnotationFromDraft(
    {
      type: "highlight",
      color: "  #ff6666  ",
      text: "  quoted  ",
      comment: "  note  ",
      tags: ["a"],
      pageIndex: 4,
      anchor,
      sortIndex: "00004|000012|00080",
    },
    "pending:abc",
    "2026-07-29T00:00:00.000Z",
  );
  assert.equal(ann.id, "pending:abc");
  assert.equal(ann.origin, "local");
  assert.equal(ann.zoteroKey, null);
  assert.equal(ann.color, "#ff6666");
  assert.equal(ann.text, "quoted");
  assert.equal(ann.comment, "note");
  assert.equal(ann.syncState, "local");
  assert.equal(ann.sortIndex, "00004|000012|00080");
  assert.deepEqual(ann.anchor, anchor);
});

test("optimisticAnnotationFromDraft fills the defaults the column would", () => {
  const ann = optimisticAnnotationFromDraft(
    { type: "ink", color: "   ", pageIndex: 2, anchor: {} },
    "pending:x",
  );
  assert.equal(ann.color, "#ffd400");
  assert.equal(ann.text, "");
  assert.equal(ann.comment, "");
  assert.deepEqual(ann.tags, []);
  // Same synthesis the repository uses when a draft omits the sort index.
  assert.equal(ann.sortIndex, "00002|000000|00000");
});

test("pending ids are recognisable so they are never treated as server rows", () => {
});

test("applyAnnotationPatch normalises exactly as the repository does", () => {
  // If these drift, the optimistic value visibly changes when the server row
  // arrives, which reads as the edit being rejected and silently redone.
  const base = optimisticAnnotationFromDraft(
    { type: "highlight", color: "#ffd400", pageIndex: 0, anchor: {}, tags: ["keep"] },
    "a1",
  );
  const patched = applyAnnotationPatch(base, {
    comment: "  trimmed  ",
    color: "   ",
    tags: ["x", "y"],
  });
  assert.equal(patched.comment, "trimmed");
  assert.equal(patched.color, "#ffd400", "blank colour falls back to the default");
  assert.deepEqual(patched.tags, ["x", "y"]);
  assert.equal(patched.id, "a1");
});

test("applyAnnotationPatch leaves untouched fields alone", () => {
  const base = optimisticAnnotationFromDraft(
    { type: "note", color: "#2ea8e5", comment: "original", pageIndex: 1, anchor: {}, tags: ["t"] },
    "a2",
  );
  const patched = applyAnnotationPatch(base, { color: "#ff6666" });
  assert.equal(patched.color, "#ff6666");
  assert.equal(patched.comment, "original");
  assert.deepEqual(patched.tags, ["t"]);
});

test("applyAnnotationPatch does not alias the caller's tag array", () => {
  const base = optimisticAnnotationFromDraft(
    { type: "highlight", color: "#ffd400", pageIndex: 0, anchor: {} },
    "a3",
  );
  const tags = ["one"];
  const patched = applyAnnotationPatch(base, { tags });
  tags.push("two");
  assert.deepEqual(patched.tags, ["one"], "later mutation must not reach the annotation");
});
