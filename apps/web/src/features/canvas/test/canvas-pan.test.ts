import assert from "node:assert/strict";
import { test } from "node:test";

import { isPanPress, midpoint } from "../application/canvas-pan";

test("middle button pans with mouse and touch", () => {
  assert.equal(isPanPress({ button: 1, pointerType: "mouse", spaceHeld: false }), true);
  assert.equal(isPanPress({ button: 1, pointerType: "touch", spaceHeld: false }), true);
});

test("space plus drag pans with a mouse", () => {
  assert.equal(isPanPress({ button: 0, pointerType: "mouse", spaceHeld: true }), true);
  assert.equal(isPanPress({ button: 0, pointerType: "mouse", spaceHeld: false }), false);
});

test("a pen never pans, whatever button or space", () => {
  assert.equal(isPanPress({ button: 0, pointerType: "pen", spaceHeld: true }), false);
  assert.equal(isPanPress({ button: 1, pointerType: "pen", spaceHeld: false }), false);
  assert.equal(isPanPress({ button: 0, pointerType: "pen", spaceHeld: false }), false);
});

test("a plain one-finger touch does not start a pan from here", () => {
  assert.equal(isPanPress({ button: 0, pointerType: "touch", spaceHeld: false }), false);
});

test("two-finger midpoint is the average of the two screen points", () => {
  assert.deepEqual(midpoint({ x: 0, y: 0 }, { x: 100, y: 40 }), { x: 50, y: 20 });
  assert.deepEqual(midpoint({ x: -10, y: 4 }, { x: 10, y: 4 }), { x: 0, y: 4 });
});
