import { test } from "node:test";
import assert from "node:assert/strict";
import { rust } from "../../src/shared/rust.js";


test("buildAnnotationSortIndex matches Zotero zero-padded shape", () => {
  assert.equal(rust().buildAnnotationSortIndex(8, 412, 574.9), "00008|000412|00574");
  assert.equal(rust().buildAnnotationSortIndex(0, 0, 0), "00000|000000|00000");
});

test("buildAnnotationSortIndex sorts lexically in reading order", () => {
  const keys = [
    rust().buildAnnotationSortIndex(1, 10, 100),
    rust().buildAnnotationSortIndex(0, 999, 50),
    rust().buildAnnotationSortIndex(1, 2, 200),
  ];
  const sorted = [...keys].sort();
  assert.deepEqual(sorted, [
    rust().buildAnnotationSortIndex(0, 999, 50),
    rust().buildAnnotationSortIndex(1, 2, 200),
    rust().buildAnnotationSortIndex(1, 10, 100),
  ]);
});
