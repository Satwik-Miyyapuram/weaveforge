import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isReaderAnnotationType,
  READER_ANNOTATION_TYPES,
} from "../src/reader/reader-annotation.js";

test("READER_ANNOTATION_TYPES is Zotero's six — no strikeout", () => {
  assert.deepEqual([...READER_ANNOTATION_TYPES], [
    "highlight",
    "underline",
    "note",
    "image",
    "ink",
    "text",
  ]);
  assert.equal(isReaderAnnotationType("highlight"), true);
  assert.equal(isReaderAnnotationType("text"), true);
  assert.equal(isReaderAnnotationType("strikeout"), false);
  assert.equal(isReaderAnnotationType(""), false);
});
