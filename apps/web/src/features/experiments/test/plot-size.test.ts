import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPACT_PX, MEDIUM_PX, MIN_CARD_PX, axisSpec, fitCols, plotHeight, plotTier } from "../ui/plot-size";

test("wide cards keep the base height", () => {
  assert.equal(plotHeight(1200, 320), 320);
});

test("aspect grows taller as cards narrow", () => {
  assert.equal(plotHeight(600, 320), 300);
  assert.equal(plotHeight(400, 320), 260);
  assert.equal(plotHeight(300, 320), 255);
});

test("plot height never drops below the floor", () => {
  assert.equal(plotHeight(MIN_CARD_PX - 100, 320), 180);
});

test("unmeasured width falls back to base", () => {
  assert.equal(plotHeight(0, 240), 240);
});

test("tiers step down at the medium and compact widths", () => {
  assert.equal(plotTier(0), "full");
  assert.equal(plotTier(MEDIUM_PX), "full");
  assert.equal(plotTier(MEDIUM_PX - 1), "medium");
  assert.equal(plotTier(COMPACT_PX), "medium");
  assert.equal(plotTier(COMPACT_PX - 1), "compact");
});

test("only the full tier draws axis titles, and gutters shrink by tier", () => {
  assert.equal(axisSpec("full").titles, true);
  assert.equal(axisSpec("medium").titles, false);
  assert.ok(axisSpec("compact").ySize <= axisSpec("medium").ySize);
  assert.ok(axisSpec("medium").ySize < axisSpec("full").ySize);
});

test("fit counts the gap between cards", () => {
  // 9 cards need 9*280 + 8*20 = 2680px, so 2600px fits only 8.
  assert.equal(fitCols(2600, 20), 8);
  assert.equal(fitCols(2680, 20), 9);
  assert.equal(fitCols(100, 20), 1);
});
