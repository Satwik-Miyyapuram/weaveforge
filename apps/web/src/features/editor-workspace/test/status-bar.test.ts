import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyStats, formatCount, formatCursor, formatWords } from "../application/document-stats";
import { saveLabel, saveState } from "../ui/status-bar";

test("an untouched document is Saved", () => {
  assert.equal(saveState({ pending: 0, dirty: false }), "saved");
  assert.equal(saveLabel("saved"), "Saved");
});

test("a write in flight says so, and beats a stale dirty flag", () => {
  assert.equal(saveState({ pending: 1, dirty: false }), "saving");
  assert.equal(saveState({ pending: 3, dirty: true }), "saving");
  assert.equal(saveLabel("saving"), "Saving…");
});

test("a change that has not reached a write is Unsaved", () => {
  assert.equal(saveState({ pending: 0, dirty: true }), "unsaved");
  assert.equal(saveLabel("unsaved"), "Unsaved");
});

test("words and characters count what is in the file, whitespace aside", () => {
  assert.deepEqual(bodyStats(""), { words: 0, chars: 0 });
  assert.deepEqual(bodyStats("one two three"), { words: 3, chars: 13 });
  // Runs of whitespace collapse: three blanks do not make three words.
  assert.deepEqual(bodyStats("  spaced \n\t out  "), { words: 2, chars: 17 });
});

test("frontmatter is part of the document and is counted", () => {
  const body = "---\ntitle: Baselines\n---\nBody text";
  assert.equal(bodyStats(body).words, 6);
  assert.equal(bodyStats(body).chars, body.length);
});

test("counts and cursors are formatted for a 26px strip", () => {
  assert.equal(formatCount(1500), "1\u2009500");
  assert.equal(formatCount(9), "9");
  assert.equal(formatCursor({ line: 7, col: 4 }), "Ln 7, Col 4");
});

test("the word segment says word for one and adds a reading time", () => {
  assert.equal(formatWords(0), "0 words");
  assert.equal(formatWords(1), "1 word · 1 min read");
  assert.equal(formatWords(238), "238 words · 1 min read");
  assert.equal(formatWords(239), "239 words · 2 min read");
  assert.equal(formatWords(12_000), "12\u2009000 words · 51 min read");
});
