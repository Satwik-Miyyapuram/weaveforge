import { test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "../rust-core";

// The orders are computed in Rust and returned as indices into the rows.
const core = readyCore();

const rows = [
  { title: "beta", updatedAt: "2026-01-02T00:00:00Z" },
  { title: "Alpha", updatedAt: "2026-03-01T00:00:00Z" },
  { title: "gamma" },
  { title: "item 10", updatedAt: "not a date" },
  { title: "item 9", updatedAt: "2026-02-01T00:00:00Z" },
];

test("relevance keeps the ranked order", () => {
  assert.deepEqual(core.sortHitOrder(rows, "relevance"), [0, 1, 2, 3, 4]);
});

test("newest puts the latest first and undated or broken dates last, in ranked order", () => {
  assert.deepEqual(core.sortHitOrder(rows, "newest"), [1, 4, 0, 2, 3]);
});

test("title sorts case-insensitively with numbers in natural order", () => {
  assert.deepEqual(core.sortHitOrder(rows, "title"), [1, 0, 2, 4, 3]);
});

test("equal keys keep their ranked order", () => {
  const ties = [
    { title: "same" },
    { title: "Same" },
    { title: "same" },
  ];
  assert.deepEqual(core.sortHitOrder(ties, "title"), [0, 1, 2]);
  assert.deepEqual(core.sortHitOrder(ties, "newest"), [0, 1, 2]);
});

test("empty input sorts to empty", () => {
  for (const order of ["relevance", "newest", "title"] as const) {
    assert.deepEqual(core.sortHitOrder([], order), []);
  }
});

test("Space previews only outside the text box; Shift+Space previews anywhere", () => {
  const key = (over: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string }>, inBox: boolean) =>
    core.isPreviewKey({ key: " ", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over }, inBox);
  assert.equal(key({}, false), true);
  assert.equal(key({}, true), false);
  assert.equal(key({ shiftKey: true }, true), true);
  // Ctrl+Space and friends belong to the system or the input method.
  assert.equal(key({ ctrlKey: true }, false), false);
  assert.equal(key({ metaKey: true }, false), false);
  assert.equal(key({ altKey: true }, false), false);
  assert.equal(key({ key: "a" }, false), false);
});