import assert from "node:assert/strict";
import test from "node:test";

import { CONTEXT, anchorAt, locateAnchor } from "../domain/text-anchor";

test("an anchor round-trips to the span it was taken from", () => {
  const text = "Alpha beta gamma. Delta epsilon.";
  const anchor = anchorAt(text, 6, 10)!;
  assert.equal(anchor.quote, "beta");
  assert.deepEqual(locateAnchor(text, anchor), { start: 6, end: 10 });
});

test("a blank selection is no anchor", () => {
  assert.equal(anchorAt("a   b", 1, 4), null);
  assert.equal(anchorAt("abc", 2, 2), null);
});

test("reversed offsets are the same span", () => {
  assert.deepEqual(anchorAt("one two", 7, 4), anchorAt("one two", 4, 7));
});

test("context is capped either side", () => {
  const text = `${"x".repeat(100)}QUOTE${"y".repeat(100)}`;
  const anchor = anchorAt(text, 100, 105)!;
  assert.equal(anchor.prefix.length, CONTEXT);
  assert.equal(anchor.suffix.length, CONTEXT);
});

test("a repeated word stays on the occurrence it was taken from", () => {
  const text = "the cat sat. the dog ran. the bird flew.";
  const second = text.indexOf("the", 5);
  const anchor = anchorAt(text, second, second + 3)!;
  assert.deepEqual(locateAnchor(text, anchor), { start: second, end: second + 3 });
});

test("an edit above the passage moves the span with it", () => {
  const before = "Intro. The claim holds here. Outro.";
  const at = before.indexOf("claim");
  const anchor = anchorAt(before, at, at + 5)!;
  const after = `A new opening paragraph.\n\n${before}`;
  const found = locateAnchor(after, anchor)!;
  assert.equal(after.slice(found.start, found.end), "claim");
  assert.equal(found.start, after.indexOf("claim"));
});

test("a changed neighbourhood still finds the best match", () => {
  const anchor = anchorAt("see the result above", 8, 14)!;
  const found = locateAnchor("see our result, above", anchor)!;
  assert.equal(found.start, 8);
});

test("a deleted passage is not pinned anywhere", () => {
  const anchor = anchorAt("keep this sentence", 5, 9)!;
  assert.equal(locateAnchor("keep that sentence", anchor), null);
});
