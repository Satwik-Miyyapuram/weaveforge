import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReaderAnnotations } from "../application/merge-reader-annotations.js";
import type { ReaderAnnotation } from "@thesis/core";

function ann(partial: Partial<ReaderAnnotation> & Pick<ReaderAnnotation, "id" | "sortIndex">): ReaderAnnotation {
  return {
    origin: "zotero",
    zoteroKey: null,
    type: "highlight",
    color: "#ffd400",
    text: "",
    comment: "",
    tags: [],
    anchor: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("mergeReaderAnnotations prefers local on id collision and sorts", () => {
  const merged = mergeReaderAnnotations(
    [
      ann({ id: "a", sortIndex: "00002|000000|00000", text: "zotero" }),
      ann({ id: "b", sortIndex: "00001|000000|00000", text: "early" }),
    ],
    [ann({ id: "a", origin: "local", sortIndex: "00002|000000|00000", text: "local" })],
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.id, "b");
  assert.equal(merged[1]!.text, "local");
  assert.equal(merged[1]!.origin, "local");
});
