import { test } from "node:test";
import assert from "node:assert/strict";
import {
  partitionZoteroItems,
  projectZoteroAnnotations,
} from "../application/project-zotero-annotations.js";
import type { ZoteroAnnotation } from "../../papers/domain/zotero.js";

const sample: ZoteroAnnotation[] = [
  {
    key: "A1",
    kind: "annotation",
    text: "quoted text",
    color: "#ff6666",
    tags: ["method"],
    annotationType: "highlight",
    annotationPosition: {
      pageIndex: 1,
      rects: [[10, 20, 30, 40]],
      nextPageRects: [[1, 2, 3, 4]],
    },
    annotationSortIndex: "00001|000010|00020",
  },
  {
    key: "N1",
    kind: "note",
    text: "a free-standing note",
    tags: [],
  },
  {
    key: "I1",
    kind: "annotation",
    annotationType: "ink",
    tags: [],
    annotationPosition: { pageIndex: 0, paths: [[0, 0, 1, 1]] },
  },
];

test("projectZoteroAnnotations skips notes and sorts by sortIndex", () => {
  const projected = projectZoteroAnnotations(sample, {
    contentHash: "abc",
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(projected.length, 2);
  assert.equal(projected[0]!.zoteroKey, "I1");
  assert.equal(projected[1]!.zoteroKey, "A1");
  assert.equal(projected[1]!.anchor.contentHash, "abc");
  assert.equal(projected[1]!.anchor.zoteroPosition?.rects?.[0]?.[0], 10);
  assert.equal(
    (projected[1]!.anchor.zoteroPosition as { nextPageRects?: number[][] }).nextPageRects?.[0]?.[0],
    1,
  );
  assert.equal(projected[1]!.origin, "zotero");
});

test("partitionZoteroItems splits annotations from notes", () => {
  const { annotations, notes } = partitionZoteroItems(sample);
  assert.equal(annotations.length, 2);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.key, "N1");
});

test("projectZoteroAnnotations rejects strikeout by falling back to highlight", () => {
  const projected = projectZoteroAnnotations([
    {
      key: "bad",
      tags: [],
      annotationType: "strikeout" as never,
      annotationPosition: { pageIndex: 0, rects: [[0, 0, 1, 1]] },
    },
  ]);
  assert.equal(projected[0]!.type, "highlight");
});
