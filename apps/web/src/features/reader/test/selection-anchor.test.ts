/**
 * Where the create popover sits over a selection.
 *
 * Pinned here: the anchor is in the scroller's content coordinates, so the
 * popover scrolls with the words; it goes under the words when there is no
 * room above them; and an empty selection gives no anchor at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { selectionAnchor } from "../ui/selection-create-bar";

function box(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

/** A scroller at (100, 50) in the window, scrolled by the given amounts. */
function scroller(scrollTop: number, scrollLeft = 0): HTMLElement {
  return {
    getBoundingClientRect: () => box(100, 50, 800, 600),
    scrollTop,
    scrollLeft,
  } as unknown as HTMLElement;
}

function range(left: number, top: number, width: number, height: number): Range {
  return { getBoundingClientRect: () => box(left, top, width, height) } as unknown as Range;
}

test("anchors at the middle of the words, in content coordinates", () => {
  const at = selectionAnchor(range(300, 250, 200, 20), scroller(1000, 30));
  assert.deepEqual(at, { x: 300 + 100 - 100 + 30, top: 250 - 50 + 1000, bottom: 250 - 50 + 1000 + 20, below: false });
});

test("goes under the words when they sit at the top of the view", () => {
  const at = selectionAnchor(range(300, 60, 200, 20), scroller(0));
  assert.equal(at?.below, true);
});

test("an empty selection has no anchor", () => {
  assert.equal(selectionAnchor(range(300, 250, 0, 0), scroller(0)), null);
});
