import { test } from "node:test";
import assert from "node:assert/strict";

import { deleteKeysFor } from "../application/canvas-keys";

test("Backspace and Delete remove the selection only while the canvas is on show and focused", () => {
  assert.deepEqual(deleteKeysFor({ screenActive: true, focusWithin: true, editing: false }), ["Backspace", "Delete"]);
});

test("the canvas off screen never takes the delete keys", () => {
  assert.equal(deleteKeysFor({ screenActive: false, focusWithin: true, editing: false }), null);
});

test("keys pressed elsewhere on the page never delete a node", () => {
  assert.equal(deleteKeysFor({ screenActive: true, focusWithin: false, editing: false }), null);
});

test("keys typed into a text card or a field edit the text, not the canvas", () => {
  assert.equal(deleteKeysFor({ screenActive: true, focusWithin: true, editing: true }), null);
});
