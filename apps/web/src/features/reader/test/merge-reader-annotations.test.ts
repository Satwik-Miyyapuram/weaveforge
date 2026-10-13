import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReaderAnnotations } from "../application/merge-reader-annotations.js";
import type { ReaderAnnotation } from "@weaveforge/core";

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

test("a local mark already sent to Zotero is not shown twice when Zotero sends it back", () => {
  // After write-back the local row carries the Zotero key it was given, and the
  // next pull brings the same mark in as a Zotero annotation under that key.
  const merged = mergeReaderAnnotations(
    [
      ann({ id: "ZK1", zoteroKey: "ZK1", sortIndex: "00001|000000|00000", text: "echo" }),
      ann({ id: "ZK2", zoteroKey: "ZK2", sortIndex: "00002|000000|00000", text: "made in Zotero" }),
    ],
    [ann({ id: "local-1", origin: "local", zoteroKey: "ZK1", sortIndex: "00001|000000|00000", text: "mine" })],
  );
  assert.deepEqual(merged.map((a) => a.id), ["local-1", "ZK2"]);
});
