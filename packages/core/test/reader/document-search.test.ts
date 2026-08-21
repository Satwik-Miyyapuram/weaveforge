import { test } from "node:test";
import assert from "node:assert/strict";
import { findDocumentMatches, nextMatchIndex } from "../../src/reader/document-search.js";

test("findDocumentMatches is case-insensitive and ordered", () => {
  const matches = findDocumentMatches(
    [
      { pageIndex: 0, text: "Alpha beta ALPHA" },
      { pageIndex: 1, text: "gamma alpha" },
    ],
    "alpha",
  );
  assert.deepEqual(matches, [
    { pageIndex: 0, start: 0, end: 5 },
    { pageIndex: 0, start: 11, end: 16 },
    { pageIndex: 1, start: 6, end: 11 },
  ]);
});

test("findDocumentMatches skips blank queries", () => {
  assert.deepEqual(findDocumentMatches([{ pageIndex: 0, text: "x" }], "  "), []);
});

test("nextMatchIndex wraps", () => {
  assert.equal(nextMatchIndex(0, 3, 1), 1);
  assert.equal(nextMatchIndex(2, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 3, -1), 2);
  assert.equal(nextMatchIndex(-1, 3, 1), 0);
  assert.equal(nextMatchIndex(0, 0, 1), -1);
});
