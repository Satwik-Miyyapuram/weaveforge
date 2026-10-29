/**
 * Dashboard cards hide what overflows them, so content taller than the card
 * was cut. On a 360px phone the Experiments tile's count wrapped to two lines
 * and, aligned on its first baseline, sat 16px lower than the percentage,
 * pushing the bar out of the tile. The Recent log card showed one row per grid
 * row, but a log row is taller than a grid row, so its last row lost 2px.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getCardDef } from "../application/card-registry";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/dashboard.css", import.meta.url)), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
};

test("a wrapped stat count stays within the percentage's height", () => {
  assert.match(rule(".dashboard-stat-row"), /align-items:\s*flex-end/);
});

test("in the brutal themes a wrapped count rises beside the number", () => {
  // These themes put the count beside the number. On its first baseline a
  // wrapped count hung a line below it and pushed the bar out of the tile.
  const brutal = readFileSync(fileURLToPath(new URL("../../../app/styles/brutal.css", import.meta.url)), "utf8");
  const at = brutal.indexOf('[data-theme="crt"]) .dashboard-stat-row {');
  assert.ok(at >= 0);
  assert.match(brutal.slice(at, brutal.indexOf("}", at)), /align-items:\s*last baseline/);
});

test("a tile too narrow for the running count drops only that part", () => {
  assert.match(rule(".dashboard-stat-link"), /container-type:\s*inline-size/);
  assert.match(css, /@container \(max-width: \d+px\) \{\s*\.dashboard-stat-extra \{ display: none; \}/);
});

test("the recent log card takes the height its rows need", () => {
  assert.equal(getCardDef("recent-log").fitContent, true);
});
