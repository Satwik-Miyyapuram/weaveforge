import { test } from "node:test";
import assert from "node:assert/strict";
import { readerKeyboardCommand } from "../src/reader/reader-keyboard.js";

test("readerKeyboardCommand maps zoom and rotate keys", () => {
  assert.deepEqual(readerKeyboardCommand({ key: "+" }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "=" }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "-" }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "r" }), { type: "rotate" });
  assert.deepEqual(readerKeyboardCommand({ key: "0", ctrlKey: true }), { type: "fit_width" });
});

test("readerKeyboardCommand maps page navigation", () => {
  assert.deepEqual(readerKeyboardCommand({ key: "ArrowDown" }), { type: "page_delta", delta: 1 });
  assert.deepEqual(readerKeyboardCommand({ key: "PageUp" }), { type: "page_delta", delta: -1 });
  assert.deepEqual(readerKeyboardCommand({ key: "Home" }), { type: "page_home" });
  assert.deepEqual(readerKeyboardCommand({ key: "End" }), { type: "page_end" });
  assert.deepEqual(readerKeyboardCommand({ key: "j" }), { type: "page_delta", delta: 1 });
  assert.deepEqual(readerKeyboardCommand({ key: "k" }), { type: "page_delta", delta: -1 });
});

test("readerKeyboardCommand ignores editable targets and unknown keys", () => {
  assert.equal(readerKeyboardCommand({ key: "ArrowDown", fromEditable: true }), null);
  assert.equal(readerKeyboardCommand({ key: "a" }), null);
  assert.equal(readerKeyboardCommand({ key: "ArrowDown", altKey: true }), null);
});
