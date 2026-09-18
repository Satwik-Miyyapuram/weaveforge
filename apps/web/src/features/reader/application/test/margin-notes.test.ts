import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReaderAnnotation } from "@weaveforge/core";
import { layoutMarginNotes } from "../margin-notes";

const projection = { pageWidth: 600, pageHeight: 800, scale: 1, rotation: 0 };

function ann(id: string, comment: string, rects?: number[][], paths?: number[][]): ReaderAnnotation {
  return {
    id, origin: "local", zoteroKey: null, type: rects ? "highlight" : "ink", color: "#ff0",
    text: "", comment, tags: [], sortIndex: id, createdAt: "", updatedAt: "",
    anchor: { zoteroPosition: { pageIndex: 0, rects, paths } },
  } as unknown as ReaderAnnotation;
}

test("only commented marks get a card, level with the mark", () => {
  const notes = layoutMarginNotes(
    [ann("a", "", [[10, 700, 100, 720]]), ann("b", "why", [[10, 500, 100, 520]])],
    projection,
  );
  assert.deepEqual(notes.map((n) => [n.annotation.id, n.top]), [["b", 280]]);
});

test("cards that would overlap stack downwards in page order", () => {
  const notes = layoutMarginNotes(
    [ann("low", "2", [[10, 680, 100, 700]]), ann("high", "1", [[10, 700, 100, 720]])],
    projection,
    64,
  );
  assert.deepEqual(notes.map((n) => [n.annotation.id, n.top]), [["high", 80], ["low", 152]]);
});

test("an ink stroke's card sits at the top of the stroke", () => {
  const notes = layoutMarginNotes([ann("s", "note", undefined, [[50, 100, 60, 300, 70, 200]])], projection);
  assert.equal(notes[0]!.top, 500);
});
