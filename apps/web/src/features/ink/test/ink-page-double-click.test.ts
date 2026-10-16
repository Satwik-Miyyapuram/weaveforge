/** A double-click opens a figure only when every press of it lands inside the box. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { doubleClickFigure, figureUnder } from "../ui/ink-page-math";

const box = { x: 100, y: 100, w: 200, h: 100 };

test("a double-click just outside a corner opens nothing", () => {
  const near = { x: 92, y: 92 };
  assert.equal(doubleClickFigure([box], [near, near, near]), null);
});

test("a double-click inside the box opens it", () => {
  const inside = { x: 150, y: 150 };
  assert.equal(doubleClickFigure([box], [inside, inside, inside]), 0);
});

test("a first press elsewhere opens nothing", () => {
  assert.equal(doubleClickFigure([box], [{ x: 10, y: 10 }, { x: 150, y: 150 }, { x: 150, y: 150 }]), null);
});

test("the figure being edited is not a target", () => {
  const inside = { x: 150, y: 150 };
  assert.equal(doubleClickFigure([box], [inside, inside], 0), null);
});

test("the topmost figure wins", () => {
  assert.equal(figureUnder([box, { x: 120, y: 120, w: 50, h: 50 }], { x: 130, y: 130 }), 1);
});
