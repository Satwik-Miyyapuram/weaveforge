import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEditableReaderTarget,
  readerKeyboardCommand,
} from "../src/reader/reader-keyboard.js";

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

test("isEditableReaderTarget treats SELECT as owning its keystrokes", () => {
  // A <select> uses arrows to change option and letters to type-ahead. The
  // reader's annotation-tool and sidebar dropdowns were unusable while it
  // only guarded INPUT/TEXTAREA.
  assert.equal(isEditableReaderTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "OPTION" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "input" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("isEditableReaderTarget lets buttons and page chrome through", () => {
  assert.equal(isEditableReaderTarget({ tagName: "BUTTON" }), false);
  assert.equal(isEditableReaderTarget({ tagName: "DIV" }), false);
  assert.equal(isEditableReaderTarget(null), false);
  assert.equal(isEditableReaderTarget(undefined), false);
  assert.equal(isEditableReaderTarget({}), false);
});

test("readerKeyboardCommand yields to editable targets for every shortcut", () => {
  for (const key of ["ArrowDown", "ArrowUp", "PageDown", "Home", "End", "+", "-", "r", "j", "k"]) {
    assert.equal(
      readerKeyboardCommand({ key, fromEditable: true }),
      null,
      `${key} should pass through to the field`,
    );
  }
});
