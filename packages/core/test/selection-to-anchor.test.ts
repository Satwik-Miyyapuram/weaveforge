import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemToRect,
  selectionToAnchor,
  type PageTextGeometry,
} from "../src/reader/selection-to-anchor.js";

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
