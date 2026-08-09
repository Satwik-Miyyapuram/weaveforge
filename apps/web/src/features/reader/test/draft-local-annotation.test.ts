import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendInkStroke,
  draftFromTextSelection,
  draftImageRegion,
  draftInkAnnotation,
  draftTextBox,
} from "../application/draft-local-annotation.js";
import { INK_MAX_PATHS_PER_ANNOTATION, type PageTextGeometry } from "@weaveforge/core";

const page: PageTextGeometry = {
  pageIndex: 2,
  pageWidth: 600,
  pageHeight: 800,
  items: [
    { str: "Hello ", transform: [1, 0, 0, 1, 50, 700], width: 40, height: 12 },
    { str: "world", transform: [1, 0, 0, 1, 90, 700], width: 35, height: 12 },
  ],
};

test("draftFromTextSelection builds highlight with Zotero sort index", () => {
  const draft = draftFromTextSelection({
    type: "highlight",
    color: "#ffd400",
    selection: { startItemIndex: 0, startOffset: 0, endItemIndex: 1, endOffset: 5 },
    page,
  });
  assert.ok(draft);
  assert.equal(draft!.type, "highlight");
  assert.equal(draft!.text, "Hello world");
  assert.equal(draft!.pageIndex, 2);
  assert.match(draft!.sortIndex!, /^00002\|/);
  assert.ok(draft!.anchor.zoteroPosition?.rects?.length);
  assert.equal(draft!.anchor.locus?.quote?.exact, "Hello world");
});

test("draftFromTextSelection returns null for empty selection", () => {
  assert.equal(
    draftFromTextSelection({
      type: "underline",
      color: "#000",
      selection: { startItemIndex: 0, startOffset: 1, endItemIndex: 0, endOffset: 1 },
      page,
    }),
    null,
  );
});

test("draftInkAnnotation stores paths, minus the points the shape implies", () => {
  const draft = draftInkAnnotation({
    color: "#2ea8e5",
    pageIndex: 0,
    pageHeight: 800,
    path: [10, 20, 30, 40, 50, 60],
  });
  assert.ok(draft);
  assert.equal(draft!.type, "ink");
  // The three captured points are collinear, so the middle one is redundant —
  // storing it would cost bytes forever and change nothing on screen.
  assert.deepEqual(draft!.anchor.zoteroPosition?.paths, [[10, 20, 50, 60]]);
  assert.equal(draft!.anchor.zoteroPosition?.width, 2, "a nib width is always stored");
});

test("draftInkAnnotation keeps a curve's shape while shrinking it", () => {
  const raw: number[] = [];
  for (let i = 0; i < 500; i++) raw.push(i * 0.4, 400 + Math.sin(i / 7) * 5);

  const draft = draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: raw });
  const stored = draft!.anchor.zoteroPosition!.paths![0]!;

  assert.ok(stored.length >= 4);
  assert.ok(
    stored.length < raw.length / 4,
    `stored ${stored.length / 2} of ${raw.length / 2} points — compaction did not run`,
  );
  assert.equal(stored[0], raw[0], "the stroke still starts where the pen touched down");
});

test("draftInkAnnotation carries the nib width a highlighter needs", () => {
  const draft = draftInkAnnotation({
    color: "#ffd400",
    pageIndex: 0,
    pageHeight: 800,
    path: [10, 20, 90, 20],
    width: 14,
  });
  assert.equal(draft!.anchor.zoteroPosition?.width, 14);
});

test("appendInkStroke keeps one mark in one row", () => {
  const first = draftInkAnnotation({
    color: "#000",
    pageIndex: 0,
    pageHeight: 800,
    path: [10, 20, 90, 20],
  })!;

  const merged = appendInkStroke(first.anchor, [10, 40, 90, 40]);

  assert.equal(merged?.zoteroPosition?.paths?.length, 2);
  assert.equal(merged?.zoteroPosition?.width, first.anchor.zoteroPosition?.width);
  assert.equal(
    appendInkStroke(first.anchor, [1, 1]),
    null,
    "a stroke too short to draw is not worth a write",
  );
});

test("appendInkStroke refuses to grow one row without bound", () => {
  const paths = Array.from({ length: INK_MAX_PATHS_PER_ANNOTATION }, () => [0, 0, 10, 10]);
  const full = { zoteroPosition: { pageIndex: 0, paths, width: 2 } };

  assert.equal(
    appendInkStroke(full, [20, 20, 30, 30]),
    null,
    "a full annotation must send the next stroke to a new row",
  );
});

test("draftInkAnnotation rejects short paths", () => {
  assert.equal(
    draftInkAnnotation({ color: "#000", pageIndex: 0, pageHeight: 800, path: [1, 2] }),
    null,
  );
});

test("draftImageRegion stores a single rect", () => {
  const draft = draftImageRegion({
    color: "#aaaaaa",
    pageIndex: 1,
    pageHeight: 800,
    rect: [10, 20, 110, 120],
  });
  assert.ok(draft);
  assert.equal(draft!.type, "image");
  assert.deepEqual(draft!.anchor.zoteroPosition?.rects, [[10, 20, 110, 120]]);
});

test("draftImageRegion rejects tiny clicks", () => {
  assert.equal(
    draftImageRegion({
      color: "#aaaaaa",
      pageIndex: 0,
      pageHeight: 800,
      rect: [10, 20, 10.5, 20.5],
    }),
    null,
  );
});

test("draftTextBox stores typed text and rect", () => {
  const draft = draftTextBox({
    color: "#5fb236",
    pageIndex: 0,
    pageHeight: 800,
    text: "Margin note",
    x: 40,
    y: 100,
  });
  assert.equal(draft.type, "text");
  assert.equal(draft.text, "Margin note");
  assert.equal(draft.anchor.locus?.quote?.exact, "Margin note");
});

test("draftTextBox sizes the rect from a dragged width/height", () => {
  // The text tool now drags out its box instead of dropping a fixed 120x24 one
  // wherever you clicked, so the drag size has to reach the stored rect.
  const draft = draftTextBox({
    color: "#5fb236",
    pageIndex: 2,
    pageHeight: 800,
    text: "Sized note",
    x: 40,
    y: 100,
    width: 220,
    height: 60,
  });
  assert.deepEqual(draft.anchor.zoteroPosition?.rects, [[40, 100, 260, 160]]);
});

test("draftTextBox falls back to a default rect when no size is given", () => {
  const draft = draftTextBox({
    color: "#5fb236",
    pageIndex: 0,
    pageHeight: 800,
    text: "Tapped note",
    x: 40,
    y: 100,
  });
  assert.deepEqual(draft.anchor.zoteroPosition?.rects, [[40, 100, 160, 124]]);
});
