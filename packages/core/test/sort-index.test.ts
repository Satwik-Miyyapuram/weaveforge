import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnotationSortIndex } from "../src/reader/sort-index.js";

test("buildAnnotationSortIndex matches Zotero zero-padded shape", () => {
  assert.equal(buildAnnotationSortIndex(8, 412, 574.9), "00008|000412|00574");
  assert.equal(buildAnnotationSortIndex(0, 0, 0), "00000|000000|00000");
});

test("buildAnnotationSortIndex sorts lexically in reading order", () => {
  const keys = [
    buildAnnotationSortIndex(1, 10, 100),
    buildAnnotationSortIndex(0, 999, 50),
    buildAnnotationSortIndex(1, 2, 200),
  ];
  const sorted = [...keys].sort();
  assert.deepEqual(sorted, [
    buildAnnotationSortIndex(0, 999, 50),
    buildAnnotationSortIndex(1, 2, 200),
    buildAnnotationSortIndex(1, 10, 100),
  ]);
});
