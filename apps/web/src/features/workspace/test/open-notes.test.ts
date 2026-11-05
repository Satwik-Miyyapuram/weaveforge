import assert from "node:assert/strict";
import { test } from "node:test";

import { holdOpenNotes, isNoteOpen } from "../application/open-notes";

test("an unknown note is not open", () => {
  assert.equal(isNoteOpen("unknown"), false);
});

test("holding a note marks only that note open until released", () => {
  const release = holdOpenNotes(["a"]);
  assert.equal(isNoteOpen("a"), true);
  assert.equal(isNoteOpen("b"), false);
  release();
  assert.equal(isNoteOpen("a"), false);
});

test("a note held twice stays open until both holds are released", () => {
  const first = holdOpenNotes(["a"]);
  const second = holdOpenNotes(["a"]);
  first();
  assert.equal(isNoteOpen("a"), true);
  second();
  assert.equal(isNoteOpen("a"), false);
});

test("releasing one hold twice releases it only once", () => {
  const first = holdOpenNotes(["a"]);
  const second = holdOpenNotes(["a"]);
  first();
  first();
  assert.equal(isNoteOpen("a"), true);
  second();
  assert.equal(isNoteOpen("a"), false);
});

test("duplicate ids in one call count once", () => {
  const release = holdOpenNotes(["a", "a"]);
  release();
  assert.equal(isNoteOpen("a"), false);
});

test("holding no notes releases to nothing", () => {
  const release = holdOpenNotes([]);
  assert.doesNotThrow(() => release());
});
