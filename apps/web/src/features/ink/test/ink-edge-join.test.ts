/**
 * Where a page-break split stroke picks up on the next sheet: the exit point
 * when it sits on that sheet's top or bottom edge, otherwise nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { joinPoint } from "../ui/ink-edge-join";

const box = { top: 100, bottom: 500 };

test("no exit point gives no join", () => {
  assert.equal(joinPoint(null, box), null);
});

test("exit on the top edge is the join point", () => {
  assert.deepEqual(joinPoint({ x: 10, y: 100 }, box), { x: 10, y: 100 });
});

test("exit on the bottom edge is the join point", () => {
  assert.deepEqual(joinPoint({ x: 10, y: 500 }, box), { x: 10, y: 500 });
});

test("exit within default tolerance of an edge is the join point", () => {
  assert.deepEqual(joinPoint({ x: 10, y: 101.2 }, box), { x: 10, y: 101.2 });
});

test("exit beyond default tolerance of an edge is not a join", () => {
  assert.equal(joinPoint({ x: 10, y: 103 }, box), null);
});

test("exit in the middle of the sheet is not a join", () => {
  assert.equal(joinPoint({ x: 10, y: 300 }, box), null);
});

test("custom tolerance widens the edge band", () => {
  assert.deepEqual(joinPoint({ x: 10, y: 103 }, box, 5), { x: 10, y: 103 });
});

test("non-finite box edge is not a join", () => {
  assert.equal(joinPoint({ x: 10, y: 100 }, { top: NaN, bottom: 500 }), null);
});
