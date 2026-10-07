import { test } from "node:test";
import assert from "node:assert/strict";
import { monthGrid } from "../date-picker";

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
