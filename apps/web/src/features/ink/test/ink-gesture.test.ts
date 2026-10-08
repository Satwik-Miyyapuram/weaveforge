/**
 * The shared routing of a down and the shared cut at the paper's edge, which
 * Notes and the reader both run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { InkGesture, StrokeEdgeSplit, type InkDownContext } from "../application/ink-gesture";

const target = () => ({ style: { cursor: "crosshair" } });
const pen = (pointerId = 1, buttons = 1) => ({ pointerId, pointerType: "pen", button: 0, buttons, currentTarget: target() });
const backTip = (pointerId = 1) => ({ pointerId, pointerType: "pen", button: 5, buttons: 32, currentTarget: target() });
const ctx = (over: Partial<InkDownContext> = {}): InkDownContext => ({ tool: "draw", tipErases: true, ...over });

test("the back tip erases before any tool is asked", () => {
  const gesture = new InkGesture("cell");
  let asked = false;
  const route = gesture.down(backTip(), ctx({ tool: "lasso", hitSelection: () => (asked = true) }));
  assert.equal(route, "erase");
  assert.equal(asked, false);
});

test("the back tip draws when the surface says it does not erase", () => {
  const gesture = new InkGesture("cell");
  assert.equal(gesture.down(backTip(), ctx({ tipErases: false })), "draw");
});

test("the lasso drags a hit selection and lassos anything else", () => {
  const gesture = new InkGesture("cell");
  assert.equal(gesture.down(pen(1), ctx({ tool: "lasso", hitSelection: () => true })), "drag");
  assert.equal(gesture.down(pen(2), ctx({ tool: "lasso", hitSelection: () => false })), "lasso");
  assert.equal(gesture.down(pen(3), ctx({ tool: "lasso" })), "lasso");
});

test("no tool and a refused pointer leave the down to the caller", () => {
  const gesture = new InkGesture("cell");
  assert.equal(gesture.down(pen(1), ctx({ tool: "none" })), null);
  assert.equal(gesture.down(pen(2), ctx({ admit: () => false })), null);
  assert.equal(gesture.route(2), null);
});

test("the eraser tool erases, an intercept wins over drawing, a region tool picks a region", () => {
  const gesture = new InkGesture("cell");
  assert.equal(gesture.down(pen(1), ctx({ tool: "eraser", intercept: () => true })), "erase");
  assert.equal(gesture.down(pen(2), ctx({ intercept: () => true })), "intercept");
  assert.equal(gesture.down(pen(3), ctx({ tool: "region" })), "region");
  assert.equal(gesture.down(pen(4), ctx()), "draw");
});

test("up returns the route, forgets it, and puts the cursor back after an eraser-tool sweep", () => {
  const gesture = new InkGesture("cell");
  const down = pen(7);
  assert.equal(gesture.down(down, ctx({ tool: "eraser" })), "erase");
  assert.equal(down.currentTarget.style.cursor, "cell");
  assert.equal(gesture.route(7), "erase");
  assert.equal(gesture.up(7), "erase");
  assert.equal(down.currentTarget.style.cursor, "crosshair");
  assert.equal(gesture.route(7), null);
  assert.equal(gesture.up(7), null);
});

// A hover reports nothing that tells the back tip from the front, so the
// eraser cursor stays with the pointer after a back-tip lift until it leaves.
test("the back tip's cursor stays through the hover after a lift and goes on leave", () => {
  const gesture = new InkGesture("cell");
  const down = backTip(7);
  gesture.down(down, ctx());
  assert.equal(gesture.up(7), "erase");
  assert.equal(down.currentTarget.style.cursor, "cell");
  gesture.leave(7);
  assert.equal(down.currentTarget.style.cursor, "crosshair");
});

test("the hovering back tip carries its cursor to the next surface", () => {
  const gesture = new InkGesture("cell");
  const down = backTip(7);
  gesture.down(down, ctx());
  gesture.up(7);
  gesture.leave(7);
  const next = target();
  gesture.hover({ pointerId: 7, currentTarget: next });
  assert.equal(next.style.cursor, "cell");
  assert.equal(down.currentTarget.style.cursor, "crosshair");
  gesture.hover({ pointerId: 8, currentTarget: target() });
  assert.equal(next.style.cursor, "cell");
});

test("a front-tip down drops the back tip's cursor", () => {
  const gesture = new InkGesture("cell");
  const down = backTip(7);
  gesture.down(down, ctx());
  gesture.up(7);
  const front = pen(7);
  front.currentTarget = down.currentTarget;
  assert.equal(gesture.down(front, ctx()), "draw");
  assert.equal(down.currentTarget.style.cursor, "crosshair");
  gesture.leave(7);
  const next = target();
  gesture.hover({ pointerId: 7, currentTarget: next });
  assert.equal(next.style.cursor, "crosshair");
});

test("a cursor the surface changed meanwhile is left alone", () => {
  const gesture = new InkGesture("cell");
  const down = backTip(7);
  gesture.down(down, ctx());
  gesture.up(7);
  down.currentTarget.style.cursor = "text";
  gesture.leave(7);
  assert.equal(down.currentTarget.style.cursor, "text");
});

const PAGE = { left: 0, top: 0, right: 100, bottom: 100 };

test("a stroke leaving the page is cut at the edge and resumes where it returns", () => {
  const edge = new StrokeEdgeSplit();
  edge.begin({ x: 50, y: 50 });
  assert.deepEqual(edge.move({ x: 50, y: 90 }, PAGE), { kind: "inside" });
  assert.deepEqual(edge.move({ x: 50, y: 110 }, PAGE), { kind: "exit", at: { x: 50, y: 100 } });
  assert.equal(edge.outside, true);
  assert.deepEqual(edge.move({ x: 60, y: 130 }, PAGE), { kind: "outside" });
  assert.deepEqual(edge.move({ x: 60, y: 90 }, PAGE), { kind: "enter", at: { x: 60, y: 100 } });
  assert.equal(edge.outside, false);
  assert.equal(edge.end(), false);
});

test("end reports a stroke that finished off the page", () => {
  const edge = new StrokeEdgeSplit();
  edge.begin({ x: 50, y: 50 });
  edge.move({ x: 50, y: 150 }, PAGE);
  assert.equal(edge.end(), true);
  assert.equal(edge.outside, false);
});

test("an area open to the sides cuts only top and bottom", () => {
  const band = { left: -Infinity, right: Infinity, top: 0, bottom: 100 };
  const edge = new StrokeEdgeSplit();
  edge.begin({ x: 50, y: 50 });
  assert.deepEqual(edge.move({ x: 5000, y: 60 }, band), { kind: "inside" });
  const exit = edge.move({ x: 5010, y: 120 }, band);
  assert.equal(exit.kind, "exit");
  assert.ok(exit.kind === "exit" && Number.isFinite(exit.at.x) && exit.at.y === 100);
});

test("a null area is all paper", () => {
  const edge = new StrokeEdgeSplit();
  edge.begin({ x: 0, y: 0 });
  assert.deepEqual(edge.move({ x: -999, y: 999 }, null), { kind: "inside" });
});
