import assert from "node:assert/strict";
import { before, test } from "node:test";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});


test("wide cards keep the base height", () => {
  assert.equal(readyCore().plotHeight(1200, 320), 320);
});

test("aspect grows taller as cards narrow", () => {
  assert.equal(readyCore().plotHeight(600, 320), 300);
  assert.equal(readyCore().plotHeight(400, 320), 260);
  assert.equal(readyCore().plotHeight(300, 320), 255);
});

test("plot height never drops below the floor", () => {
  assert.equal(readyCore().plotHeight(280 - 100, 320), 180);
});

test("unmeasured width falls back to base", () => {
  assert.equal(readyCore().plotHeight(0, 240), 240);
});

test("tiers step down at the medium and compact widths", () => {
  assert.equal(readyCore().plotTier(0), "full");
  assert.equal(readyCore().plotTier(560), "full");
  assert.equal(readyCore().plotTier(560 - 1), "medium");
  assert.equal(readyCore().plotTier(360), "medium");
  assert.equal(readyCore().plotTier(360 - 1), "compact");
});

test("only the full tier draws axis titles, and gutters shrink by tier", () => {
  assert.equal(readyCore().axisSpec("full").titles, true);
  assert.equal(readyCore().axisSpec("medium").titles, false);
  assert.ok(readyCore().axisSpec("compact").ySize <= readyCore().axisSpec("medium").ySize);
  assert.ok(readyCore().axisSpec("medium").ySize < readyCore().axisSpec("full").ySize);
});

test("fit counts the gap between cards", () => {
  // 9 cards need 9*280 + 8*20 = 2680px, so 2600px fits only 8.
  assert.equal(readyCore().fitCols(2600, 20), 8);
  assert.equal(readyCore().fitCols(2680, 20), 9);
  assert.equal(readyCore().fitCols(100, 20), 1);
});
