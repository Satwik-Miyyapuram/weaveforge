/**
 * A narrow reader (a split pane) folds its side column to the rail.
 *
 * Beside the page the 240px column left the page 0-24px wide; stacked under it
 * in a short pane neither was usable. What is pinned: under the threshold is
 * narrow, at or over it is wide, and a hidden (0-wide) reader keeps its last
 * answer so a background tab does not flip when it is shown again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isNarrow, NARROW_READER_PX } from "../ui/pdf-reader/use-narrow-width";

test("under the threshold is narrow, at it is wide", () => {
  assert.equal(isNarrow(NARROW_READER_PX - 1, false), true);
  assert.equal(isNarrow(NARROW_READER_PX, true), false);
  assert.equal(isNarrow(1400, true), false);
});

test("a hidden reader keeps its last answer", () => {
  assert.equal(isNarrow(0, true), true);
  assert.equal(isNarrow(0, false), false);
});
