import assert from "node:assert/strict";
import test from "node:test";
import { Text } from "@codemirror/state";
import { dropAnchor } from "../markdown-image-paste";

const doc = Text.of(["first line", "a sentence here", ""]);

test("a drop inside a word moves to the nearer edge of its line (E31)", () => {
  // "a sentence here" starts at 11; 13 is inside "sentence", nearer the start.
  assert.equal(dropAnchor(doc, 13), 11);
  // 24 is inside "here", nearer the end (26).
  assert.equal(dropAnchor(doc, 24), 26);
});

test("a drop already at a line edge stays put", () => {
  assert.equal(dropAnchor(doc, 0), 0);
  assert.equal(dropAnchor(doc, 10), 10);
  assert.equal(dropAnchor(doc, 27), 27);
});
