import { test } from "node:test";
import assert from "node:assert/strict";
import { HIT_SORTS, isPreviewKey, sortHits } from "../palette-sort";

const rows = [
  { title: "beta", updatedAt: "2026-01-02T00:00:00Z" },
  { title: "Alpha", updatedAt: "2026-03-01T00:00:00Z" },
  { title: "gamma" },
  { title: "item 10", updatedAt: "not a date" },
  { title: "item 9", updatedAt: "2026-02-01T00:00:00Z" },
];

test("relevance keeps the ranked order and does not mutate the input", () => {
  const before = rows.map((row) => row.title);
  const sorted = sortHits(rows, "relevance");
  assert.deepEqual(sorted.map((row) => row.title), before);
  assert.notEqual(sorted, rows);
  assert.deepEqual(rows.map((row) => row.title), before);
});

test("newest puts the latest first and undated or broken dates last, in ranked order", () => {
  assert.deepEqual(sortHits(rows, "newest").map((row) => row.title), ["Alpha", "item 9", "beta", "gamma", "item 10"]);
});

test("title sorts case-insensitively with numbers in natural order", () => {
  assert.deepEqual(sortHits(rows, "title").map((row) => row.title), ["Alpha", "beta", "gamma", "item 9", "item 10"]);
});

test("equal keys keep their ranked order", () => {
  const ties = [
    { title: "same", id: 1 },
    { title: "Same", id: 2 },
    { title: "same", id: 3 },
  ];
  assert.deepEqual(sortHits(ties, "title").map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(sortHits(ties, "newest").map((row) => row.id), [1, 2, 3]);
});

test("empty input sorts to empty", () => {
  for (const { value } of HIT_SORTS) assert.deepEqual(sortHits([], value), []);
});

test("every sort has a label", () => {
  assert.deepEqual(HIT_SORTS.map((sort) => sort.value), ["relevance", "newest", "title"]);
  for (const sort of HIT_SORTS) assert.ok(sort.label.length > 0);
});

test("Space previews only outside the text box; Shift+Space previews anywhere", () => {
  const key = (over: Partial<Parameters<typeof isPreviewKey>[0]>) =>
    isPreviewKey({ key: " ", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over }, false);
  assert.equal(key({}), true);
  assert.equal(isPreviewKey({ key: " ", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, true), false);
  assert.equal(isPreviewKey({ key: " ", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false }, true), true);
  // Ctrl+Space and friends belong to the system or the input method.
  assert.equal(key({ ctrlKey: true }), false);
  assert.equal(key({ metaKey: true }), false);
  assert.equal(key({ altKey: true }), false);
  assert.equal(key({ key: "a" }), false);
});
