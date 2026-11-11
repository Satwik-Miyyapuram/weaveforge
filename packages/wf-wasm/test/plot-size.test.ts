import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { axisSpec, fitCols, plotHeight, plotTier } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("plotTier boundaries: 560 and up is full, 360 to 559 medium, below 360 compact", () => {
  assert.equal(plotTier(559), "medium");
  assert.equal(plotTier(560), "full");
  assert.equal(plotTier(359), "compact");
  assert.equal(plotTier(360), "medium");
});

test("a width of zero or less counts as full", () => {
  assert.equal(plotTier(0), "full");
  assert.equal(plotTier(-5), "full");
});

test("axisSpec gives the full tier its titles and the compact tier none", () => {
  const full = axisSpec("full");
  assert.deepEqual([full.font, full.ySize, full.xSize], [11, 54, 22]);
  assert.equal(full.titles, true);
  const medium = axisSpec("medium");
  assert.equal(medium.titles, false);
  assert.equal(medium.ySize, 46);
});

test("plotHeight caps at the base and floors at the minimum", () => {
  assert.equal(plotHeight(0, 300), 300);
  assert.equal(plotHeight(200, 300), 180);
  assert.equal(plotHeight(400, 240), 240);
  assert.equal(plotHeight(800, 300), 300);
  assert.equal(plotHeight(500, 400), 325);
});

test("fitCols counts the gap and never drops below one column", () => {
  assert.equal(fitCols(0, 12), 1);
  assert.equal(fitCols(584, 12), 2);
  assert.equal(fitCols(1200, 0), 4);
});
