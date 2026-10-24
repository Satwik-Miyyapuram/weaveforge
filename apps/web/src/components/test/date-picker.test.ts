import { test } from "node:test";
import assert from "node:assert/strict";
import { monthGrid, openFocusDay } from "../date-picker";

test("monthGrid starts on the Monday on or before the 1st and spans 6 weeks", () => {
  const g = monthGrid(2026, 9); // October 2026: the 1st is a Thursday
  assert.equal(g.length, 42);
  assert.deepEqual(g[0], [2026, 8, 28]);
  assert.deepEqual(g[3], [2026, 9, 1]);
  assert.deepEqual(g[41], [2026, 10, 8]);
});

test("monthGrid crosses the year boundary", () => {
  const g = monthGrid(2027, 0); // January 2027: the 1st is a Friday
  assert.deepEqual(g[0], [2026, 11, 28]);
  assert.deepEqual(g[4], [2027, 0, 1]);
});

// 12-08: the portalled panel takes focus on open, on a day that can be picked.
test("openFocusDay prefers the selected day, then today, then the first enabled day", () => {
  assert.equal(openFocusDay(2026, 9, "2026-10-15", "2026-10-03"), "2026-10-15");
  assert.equal(openFocusDay(2026, 9, "", "2026-10-03"), "2026-10-03");
  assert.equal(openFocusDay(2026, 9, "", "2026-11-03"), "2026-10-01", "today outside the view");
  assert.equal(openFocusDay(2026, 9, "2026-11-02", "2026-12-01"), "2026-10-01", "selected outside the view");
});

test("openFocusDay skips days before min", () => {
  assert.equal(openFocusDay(2026, 9, "2026-10-02", "2026-10-03", "2026-10-10"), "2026-10-10");
  assert.equal(openFocusDay(2026, 9, "", "2026-10-03", "2026-10-20"), "2026-10-20");
  assert.equal(openFocusDay(2026, 9, "", "2026-10-25", "2026-10-20"), "2026-10-25");
  assert.equal(openFocusDay(2026, 9, "", "2026-10-03", "2026-12-01"), null, "whole month disabled");
});
