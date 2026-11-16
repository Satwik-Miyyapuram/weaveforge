import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasKeyAction, focusesOnPress } from "../application/canvas-keys";

const ready = { screenActive: true, focusWithin: true, editing: false, textEntry: false };
const press = (key: string, ctrl = false, shift = false) => ({ key, ctrl, shift });

test("Backspace and Delete remove the selection only while the canvas is on show and focused", () => {
  assert.deepEqual(canvasKeyAction(ready, press("Backspace")), { kind: "delete" });
  assert.deepEqual(canvasKeyAction(ready, press("Delete")), { kind: "delete" });
});

test("the canvas off screen never takes the delete keys", () => {
  assert.equal(canvasKeyAction({ ...ready, screenActive: false }, press("Delete")), null);
});

test("keys pressed elsewhere on the page never delete a node", () => {
  assert.equal(canvasKeyAction({ ...ready, focusWithin: false }, press("Delete")), null);
});

test("keys typed into a text card or a field edit the text, not the canvas", () => {
  assert.equal(canvasKeyAction({ ...ready, editing: true }, press("Delete")), null);
  assert.equal(canvasKeyAction({ ...ready, editing: true }, press("z", true)), null);
});

test("keys typed into a toolbar field stay in the field: no delete, no undo, no nudge", () => {
  const field = { ...ready, textEntry: true };
  assert.equal(canvasKeyAction(field, press("Backspace")), null);
  assert.equal(canvasKeyAction(field, press("Delete")), null);
  assert.equal(canvasKeyAction(field, press("z", true)), null);
  assert.equal(canvasKeyAction(field, press("ArrowLeft")), null);
});

test("Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo", () => {
  assert.deepEqual(canvasKeyAction(ready, press("z", true)), { kind: "undo" });
  assert.deepEqual(canvasKeyAction(ready, press("Z", true, true)), { kind: "redo" });
  assert.deepEqual(canvasKeyAction(ready, press("y", true)), { kind: "redo" });
  assert.equal(canvasKeyAction(ready, press("c", true)), null);
});

test("arrow keys nudge the selection one pixel, ten with Shift", () => {
  assert.deepEqual(canvasKeyAction(ready, press("ArrowLeft")), { kind: "nudge", dx: -1, dy: 0 });
  assert.deepEqual(canvasKeyAction(ready, press("ArrowDown", false, true)), { kind: "nudge", dx: 0, dy: 10 });
  assert.equal(canvasKeyAction(ready, press("a")), null);
});

test("a press takes focus into the canvas only while it is on show, never from a text field", () => {
  assert.equal(focusesOnPress({ screenActive: true, textEntry: false }), true);
  assert.equal(focusesOnPress({ screenActive: false, textEntry: false }), false, "a hidden canvas keeps focus where it is");
  assert.equal(focusesOnPress({ screenActive: true, textEntry: true }), false, "typing in a field is not stolen");
});
