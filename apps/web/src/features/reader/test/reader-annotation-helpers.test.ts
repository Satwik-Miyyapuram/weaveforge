import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotationPinKey,
  READER_ANNOTATION_COLORS,
} from "../application/reader-annotation-helpers.js";

test("annotationPinKey prefers zoteroKey", () => {
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: "ABCD1234" }), "ABCD1234");
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: null }), "local-1");
  assert.equal(annotationPinKey({ id: "local-1", zoteroKey: "  " }), "local-1");
});

test("READER_ANNOTATION_COLORS has stable Zotero-like palette", () => {
  assert.ok(READER_ANNOTATION_COLORS.includes("#ffd400"));
  assert.equal(READER_ANNOTATION_COLORS.length, 8);
});
