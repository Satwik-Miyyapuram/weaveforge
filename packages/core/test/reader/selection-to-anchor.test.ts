import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemToRect,
  selectionToAnchor,
  type PageTextGeometry,
} from "../../src/reader/selection-to-anchor.js";

function geometry(overrides?: Partial<PageTextGeometry>): PageTextGeometry {
  return {
    pageIndex: 2,
    pageWidth: 612,
    pageHeight: 792,
    contentHash: "hash-abc",
    items: [
      { str: "Hello ", transform: [1, 0, 0, 1, 72, 700], width: 40, height: 12 },
      { str: "world", transform: [1, 0, 0, 1, 112, 700], width: 36, height: 12 },
      { str: "today", transform: [1, 0, 0, 1, 72, 680], width: 36, height: 12, hasEOL: true },
    ],
    ...overrides,
  };
}

test("selectionToAnchor returns null for empty or out-of-range selection", () => {
  const page = geometry();
  assert.equal(
    selectionToAnchor(
      { startItemIndex: 0, startOffset: 1, endItemIndex: 0, endOffset: 1 },
      page,
    ),
    null,
  );
  assert.equal(
    selectionToAnchor(
      { startItemIndex: 9, startOffset: 0, endItemIndex: 9, endOffset: 1 },
      page,
    ),
    null,
  );
});

test("selectionToAnchor builds quote + rects + contentHash", () => {
  const page = geometry();
  const anchor = selectionToAnchor(
    { startItemIndex: 0, startOffset: 0, endItemIndex: 1, endOffset: 5 },
    page,
  );
  assert.ok(anchor);
  assert.equal(anchor!.contentHash, "hash-abc");
  assert.equal(anchor!.locus?.quote.exact, "Hello world");
  assert.equal(anchor!.zoteroPosition?.pageIndex, 2);
  assert.equal(anchor!.zoteroPosition?.rects?.length, 2);
  assert.deepEqual(anchor!.zoteroPosition?.rects?.[0], [72, 700, 112, 712]);
  assert.equal(anchor!.locus?.position?.start, 0);
  assert.equal(anchor!.locus?.position?.end, 11);
});

test("selectionToAnchor normalises inverted ranges", () => {
  const page = geometry();
  const anchor = selectionToAnchor(
    { startItemIndex: 1, startOffset: 5, endItemIndex: 0, endOffset: 0 },
    page,
  );
  assert.equal(anchor?.locus?.quote.exact, "Hello world");
});

test("itemToRect maps transform to PDF user-space box", () => {
  assert.deepEqual(
    itemToRect({ str: "x", transform: [1, 0, 0, 1, 10, 20], width: 5, height: 8 }),
    [10, 20, 15, 28],
  );
  assert.equal(itemToRect({ str: "x", transform: [1], width: 1, height: 1 }), null);
});

test("itemToRect narrows to a character sub-range", () => {
  const item = { str: "abcd", transform: [1, 0, 0, 1, 100, 500], width: 40, height: 10 };
  // Whole item, explicitly and by default.
  assert.deepEqual(itemToRect(item), [100, 500, 140, 510]);
  assert.deepEqual(itemToRect(item, 0, 4), [100, 500, 140, 510]);
  // Second half only — half the advance width, same baseline.
  assert.deepEqual(itemToRect(item, 2, 4), [120, 500, 140, 510]);
  assert.deepEqual(itemToRect(item, 1, 2), [110, 500, 120, 510]);
});

test("itemToRect clamps out-of-range bounds and drops empty slices", () => {
  const item = { str: "abcd", transform: [1, 0, 0, 1, 100, 500], width: 40, height: 10 };
  assert.deepEqual(itemToRect(item, -5, 99), [100, 500, 140, 510]);
  assert.equal(itemToRect(item, 2, 2), null);
  // Reversed bounds collapse rather than producing a negative-width rect.
  assert.equal(itemToRect(item, 3, 1), null);
});

test("selectionToAnchor clips the first and last rect to the selected characters", () => {
  // "lo world" — starts 4 chars into "Hello " (width 40 over 6 chars) and ends
  // at "world"'s end. The old code emitted the full "Hello " rect, so a
  // mid-word highlight painted the words before it too.
  const page = geometry();
  const anchor = selectionToAnchor(
    { startItemIndex: 0, startOffset: 4, endItemIndex: 1, endOffset: 5 },
    page,
  );
  assert.ok(anchor);
  const rects = anchor.zoteroPosition?.rects;
  assert.equal(rects?.length, 2);
  // 72 + 40 * (4/6) = 98.666…, not 72.
  assert.ok(rects![0]![0]! > 98 && rects![0]![0]! < 99, `left was ${rects![0]![0]}`);
  assert.equal(rects![0]![2], 112);
  // The fully covered trailing item keeps its whole rect.
  assert.deepEqual(rects![1], [112, 700, 148, 712]);
});

test("selectionToAnchor keeps whole rects for fully covered middle items", () => {
  const page = geometry();
  const anchor = selectionToAnchor(
    { startItemIndex: 0, startOffset: 0, endItemIndex: 2, endOffset: 5 },
    page,
  );
  assert.deepEqual(anchor?.zoteroPosition?.rects, [
    [72, 700, 112, 712],
    [112, 700, 148, 712],
    [72, 680, 108, 692],
  ]);
});
