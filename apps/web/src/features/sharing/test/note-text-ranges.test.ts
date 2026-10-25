import { test } from "node:test";
import assert from "node:assert/strict";

import { spanPoints } from "../ui/note-text-ranges";

test("a span inside one text node stays in that node", () => {
  assert.deepEqual(spanPoints([10], { start: 2, end: 5 }), { start: [0, 2], end: [0, 5] });
});

test("a span across nodes starts in one and ends in a later one", () => {
  assert.deepEqual(spanPoints([4, 3, 6], { start: 2, end: 9 }), { start: [0, 2], end: [2, 2] });
});

test("a boundary between nodes lands at the end of the earlier node", () => {
  assert.deepEqual(spanPoints([4, 4], { start: 4, end: 8 }), { start: [0, 4], end: [1, 4] });
});

test("a span past the end of the text is null", () => {
  assert.equal(spanPoints([3, 2], { start: 1, end: 6 }), null);
  assert.equal(spanPoints([], { start: 0, end: 1 }), null);
});
