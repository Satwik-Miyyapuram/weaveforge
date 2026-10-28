/**
 * Team roster and Team attention stood ~300 px tall holding one line, so the
 * first screen was mostly empty card (design D22, DA-128). List cards now take
 * the rows their content needs while the dashboard is viewed; charts and stat
 * tiles keep the size they were given. Editing shows the saved size, so what
 * the reader drags is what is stored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DashboardLayoutItem } from "@weaveforge/core";
import { fitLayoutToContent, rowsForHeight, FIT_MIN_ROWS } from "../application/fit-card-height";
import { getCardDef } from "../application/card-registry";

const item = (id: string, type: DashboardLayoutItem["type"], h: number): DashboardLayoutItem => ({ id, type, x: 0, y: 0, w: 12, h });

test("rows for a height count the gap between rows", () => {
  // 48 px rows, 8 px gaps: n rows span 48n + 8(n-1).
  assert.equal(rowsForHeight(48, 48, 8), 1);
  assert.equal(rowsForHeight(104, 48, 8), 2);
  assert.equal(rowsForHeight(105, 48, 8), 3);
  assert.equal(rowsForHeight(0, 48, 8), 0);
});

test("only the list cards fit their content", () => {
  assert.equal(getCardDef("team-roster").fitContent, true);
  assert.equal(getCardDef("team-attention").fitContent, true);
  assert.notEqual(getCardDef("reading-progress").fitContent, true, "stat tiles keep their size");
});

test("in view, a list card takes the rows its content needs", () => {
  const items = [item("team", "team-roster", 4), item("attn", "team-attention", 3), item("reading", "reading-progress", 2)];
  const fitted = fitLayoutToContent(items, new Map([["team", 2], ["attn", 2], ["reading", 1]]), false);
  assert.deepEqual(fitted.map((it) => it.h), [2, 2, 2], "the stat tile ignores a measurement");
});

test("a fitted card stays between the floor and the card's largest size", () => {
  const items = [item("team", "team-roster", 4), item("attn", "team-attention", 3)];
  const max = getCardDef("team-roster").maxSize.h;
  const fitted = fitLayoutToContent(items, new Map([["team", 40], ["attn", 0]]), false);
  assert.deepEqual(fitted.map((it) => it.h), [max, FIT_MIN_ROWS]);
});

test("a card not measured yet, and every card while editing, keeps its saved height", () => {
  const items = [item("team", "team-roster", 4)];
  assert.equal(fitLayoutToContent(items, new Map(), false)[0]!.h, 4);
  assert.equal(fitLayoutToContent(items, new Map([["team", 2]]), true)[0]!.h, 4);
});

test("the grid measures list cards and never saves a fitted height", () => {
  const grid = readFileSync(fileURLToPath(new URL("../ui/dashboard-grid.tsx", import.meta.url)), "utf8");
  assert.match(grid, /fitLayoutToContent\(/);
  assert.match(grid, /className="dashboard-card-fit"/);
  // The phone layout is written back in view mode, so its stored heights go back in first.
  assert.match(grid, /withStoredHeights\(/);
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/dashboard.css", import.meta.url)), "utf8");
  assert.match(css, /\.dashboard-card-fit \{[^}]*flex: none;/);
});
