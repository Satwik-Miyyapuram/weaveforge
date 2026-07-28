import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pageNumberFromHost,
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

test("pageNumberFromHost reads data-page", () => {
  assert.equal(pageNumberFromHost({ dataset: { page: "3" } }), 3);
  assert.equal(pageNumberFromHost(null), null);
  assert.equal(pageNumberFromHost({ dataset: { page: "0" } }), null);
  assert.equal(pageNumberFromHost({ dataset: { page: "x" } }), null);
});
