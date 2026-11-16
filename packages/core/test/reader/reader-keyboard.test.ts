import { test } from "node:test";
import assert from "node:assert/strict";
import { rust } from "../../src/shared/rust.js";

test("readerKeyboardCommand maps zoom and rotate keys", () => {
  assert.deepEqual(rust().readerKeyboardCommand({ key: "+" }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "=" }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "-" }), { type: "zoom_out" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "r" }), { type: "rotate" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "0", ctrlKey: true }), { type: "fit_width" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "+", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "=", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "-", ctrlKey: true }), { type: "zoom_out" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "Add" }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "Subtract" }), { type: "zoom_out" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "=", code: "Equal", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "-", code: "Minus", ctrlKey: true }), { type: "zoom_out" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "0", code: "Digit0", ctrlKey: true }), { type: "fit_width" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "0", code: "Numpad0", metaKey: true }), { type: "fit_width" });
});

test("readerKeyboardCommand maps page navigation", () => {
  assert.deepEqual(rust().readerKeyboardCommand({ key: "ArrowDown" }), { type: "page_delta", delta: 1 });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "PageUp" }), { type: "page_delta", delta: -1 });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "Home" }), { type: "page_home" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "End" }), { type: "page_end" });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "j" }), { type: "page_delta", delta: 1 });
  assert.deepEqual(rust().readerKeyboardCommand({ key: "k" }), { type: "page_delta", delta: -1 });
});

test("readerKeyboardCommand ignores editable targets and unknown keys", () => {
  assert.equal(rust().readerKeyboardCommand({ key: "ArrowDown", fromEditable: true }), null);
  assert.equal(rust().readerKeyboardCommand({ key: "a" }), null);
  assert.equal(rust().readerKeyboardCommand({ key: "ArrowDown", altKey: true }), null);
});

test("isEditableReaderTarget treats SELECT as owning its keystrokes", () => {
  // A <select> uses arrows to change option and letters to type-ahead. The
  // reader's annotation-tool and sidebar dropdowns were unusable while it
  // only guarded INPUT/TEXTAREA.
  assert.equal(rust().isEditableReaderTarget({ tagName: "SELECT" }), true);
  assert.equal(rust().isEditableReaderTarget({ tagName: "OPTION" }), true);
  assert.equal(rust().isEditableReaderTarget({ tagName: "INPUT" }), true);
  assert.equal(rust().isEditableReaderTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(rust().isEditableReaderTarget({ tagName: "input" }), true);
  assert.equal(rust().isEditableReaderTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("isEditableReaderTarget lets buttons and page chrome through", () => {
  assert.equal(rust().isEditableReaderTarget({ tagName: "BUTTON" }), false);
  assert.equal(rust().isEditableReaderTarget({ tagName: "DIV" }), false);
  assert.equal(rust().isEditableReaderTarget(null), false);
  assert.equal(rust().isEditableReaderTarget(undefined), false);
  assert.equal(rust().isEditableReaderTarget({}), false);
});

test("readerKeyboardCommand yields to editable targets for every shortcut", () => {
  for (const key of ["ArrowDown", "ArrowUp", "PageDown", "Home", "End", "+", "-", "r", "j", "k"]) {
    assert.equal(
      rust().readerKeyboardCommand({ key, fromEditable: true }),
      null,
      `${key} should pass through to the field`,
    );
  }
});

test("Ctrl/Cmd+R is left to the browser as reload, not rotate (07-01)", () => {
  assert.equal(rust().readerKeyboardCommand({ key: "r", ctrlKey: true }), null);
  assert.equal(rust().readerKeyboardCommand({ key: "r", metaKey: true }), null);
  assert.equal(rust().readerKeyboardCommand({ key: "R", ctrlKey: true }), null);
  assert.deepEqual(rust().readerKeyboardCommand({ key: "R" }), { type: "rotate" });
});
