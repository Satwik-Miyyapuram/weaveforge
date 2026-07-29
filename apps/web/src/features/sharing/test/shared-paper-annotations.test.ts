import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedPaperAnnotationSummary } from "../application/shared-paper-annotations.js";

test("sharedPaperAnnotationSummary counts projected annotations", () => {
  const summary = sharedPaperAnnotationSummary({
    annotations: [
      {
        key: "A1",
        kind: "annotation",
        annotationType: "highlight",
        text: "Hello world",
        tags: [],
        annotationPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
        annotationSortIndex: "00000|000000|00000",
      },
      {
        key: "N1",
        kind: "note",
        text: "child note",
        tags: [],
      },
    ],
  });
  assert.equal(summary.count, 1);
  assert.deepEqual(summary.samples, ["Hello world"]);
});

test("sharedPaperAnnotationSummary handles missing metadata", () => {
  assert.deepEqual(sharedPaperAnnotationSummary(undefined), { count: 0, samples: [] });
});
