import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pageNumberFromSelection,
  pageSpanFromSelection,
  textSelectionFromOffsets,
} from "../application/dom-selection-range.js";

test("textSelectionFromOffsets builds a range", () => {
  assert.deepEqual(textSelectionFromOffsets({ itemIndex: 0, offset: 1 }, { itemIndex: 2, offset: 4 }), {
    startItemIndex: 0,
    startOffset: 1,
    endItemIndex: 2,
    endOffset: 4,
  });
});

test("textSelectionFromOffsets rejects empty and invalid", () => {
  assert.equal(
    textSelectionFromOffsets({ itemIndex: 1, offset: 3 }, { itemIndex: 1, offset: 3 }),
    null,
  );
  assert.equal(
    textSelectionFromOffsets({ itemIndex: -1, offset: 0 }, { itemIndex: 0, offset: 1 }),
    null,
  );
  assert.equal(
    textSelectionFromOffsets({ itemIndex: 0, offset: -1 }, { itemIndex: 0, offset: 1 }),
    null,
  );
});

test("pageSpanFromSelection and pageNumberFromSelection resolve single page selection", () => {
  const pageHost = { dataset: { page: "3" } };
  const mockNode = {
    nodeType: 3,
    parentElement: {
      closest: (sel: string) => (sel === "[data-page]" ? pageHost : null),
    },
  };
  const scrollRoot = {
    contains: (node: unknown) => node === pageHost,
  } as unknown as Element;
  const mockSelection = {
    rangeCount: 1,
    getRangeAt: () => ({
      startContainer: mockNode as unknown as Node,
      startOffset: 0,
      endContainer: mockNode as unknown as Node,
      endOffset: 5,
    }),
  } as unknown as Selection;

  assert.deepEqual(pageSpanFromSelection(mockSelection, scrollRoot), { startPage: 3, endPage: 3 });
  assert.equal(pageNumberFromSelection(mockSelection, scrollRoot), 3);
});

test("pageSpanFromSelection and pageNumberFromSelection resolve cross-page selection", () => {
  const pageHost1 = { dataset: { page: "4" } };
  const pageHost2 = { dataset: { page: "5" } };
  const startNode = {
    nodeType: 3,
    parentElement: {
      closest: (sel: string) => (sel === "[data-page]" ? pageHost1 : null),
    },
  };
  const endNode = {
    nodeType: 3,
    parentElement: {
      closest: (sel: string) => (sel === "[data-page]" ? pageHost2 : null),
    },
  };
  const scrollRoot = {
    contains: (node: unknown) => node === pageHost1 || node === pageHost2,
  } as unknown as Element;
  const mockSelection = {
    rangeCount: 1,
    getRangeAt: () => ({
      startContainer: startNode as unknown as Node,
      startOffset: 10,
      endContainer: endNode as unknown as Node,
      endOffset: 20,
    }),
  } as unknown as Selection;

  assert.deepEqual(pageSpanFromSelection(mockSelection, scrollRoot), { startPage: 4, endPage: 5 });
  // pageNumberFromSelection returns null for cross-page selection
  assert.equal(pageNumberFromSelection(mockSelection, scrollRoot), null);
});

test("pageSpanFromSelection returns null for empty or null selection", () => {
  const scrollRoot = {} as unknown as Element;
  assert.equal(pageSpanFromSelection(null, scrollRoot), null);
  assert.equal(pageSpanFromSelection({ rangeCount: 0 } as unknown as Selection, scrollRoot), null);
});

