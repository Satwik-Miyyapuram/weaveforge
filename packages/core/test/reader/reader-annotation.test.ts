import { test } from "node:test";
import assert from "node:assert/strict";
import { READER_ANNOTATION_TYPES } from "../../src/reader/parts.js";
import { rust } from "../../src/shared/rust.js";

test("READER_ANNOTATION_TYPES is Zotero's six — no strikeout", () => {
  assert.deepEqual([...READER_ANNOTATION_TYPES], [
    "highlight",
    "underline",
    "note",
    "image",
    "ink",
    "text",
  ]);
  assert.equal(rust().isReaderAnnotationType("highlight"), true);
  assert.equal(rust().isReaderAnnotationType("text"), true);
  assert.equal(rust().isReaderAnnotationType("strikeout"), false);
  assert.equal(rust().isReaderAnnotationType(""), false);
});
