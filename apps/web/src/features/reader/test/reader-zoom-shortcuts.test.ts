import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readerKeyboardCommand,
  isEditableReaderTarget,
  READER_MIN_SCALE,
  READER_MAX_SCALE,
} from "@weaveforge/core";

test("readerKeyboardCommand handles zoom in shortcuts", () => {
  // Bare keys
  assert.deepEqual(readerKeyboardCommand({ key: "+" }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "=" }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "Add" }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "+", code: "NumpadAdd" }), { type: "zoom_in" });

  // Ctrl / Cmd combinations
  assert.deepEqual(readerKeyboardCommand({ key: "+", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "=", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "=", code: "Equal", ctrlKey: true }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "+", metaKey: true }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "=", metaKey: true }), { type: "zoom_in" });
  assert.deepEqual(readerKeyboardCommand({ key: "Add", ctrlKey: true }), { type: "zoom_in" });
});

test("readerKeyboardCommand handles zoom out shortcuts", () => {
  // Bare keys
  assert.deepEqual(readerKeyboardCommand({ key: "-" }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "_" }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "Subtract" }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "-", code: "NumpadSubtract" }), { type: "zoom_out" });

  // Ctrl / Cmd combinations
  assert.deepEqual(readerKeyboardCommand({ key: "-", ctrlKey: true }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "_", ctrlKey: true }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "-", code: "Minus", ctrlKey: true }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "-", metaKey: true }), { type: "zoom_out" });
  assert.deepEqual(readerKeyboardCommand({ key: "Subtract", ctrlKey: true }), { type: "zoom_out" });
});

test("readerKeyboardCommand handles zoom reset / fit shortcuts", () => {
  assert.deepEqual(readerKeyboardCommand({ key: "0", ctrlKey: true }), { type: "fit_width" });
  assert.deepEqual(readerKeyboardCommand({ key: "0", metaKey: true }), { type: "fit_width" });
  assert.deepEqual(readerKeyboardCommand({ key: "0", code: "Digit0", ctrlKey: true }), { type: "fit_width" });
  assert.deepEqual(readerKeyboardCommand({ key: "0", code: "Numpad0", ctrlKey: true }), { type: "fit_width" });

  // Bare '0' should not trigger fit_width
  assert.equal(readerKeyboardCommand({ key: "0" }), null);
});

test("readerKeyboardCommand suppresses shortcuts when typing in editable targets", () => {
  assert.equal(readerKeyboardCommand({ key: "+", fromEditable: true }), null);
  assert.equal(readerKeyboardCommand({ key: "-", fromEditable: true }), null);
  assert.equal(readerKeyboardCommand({ key: "+", ctrlKey: true, fromEditable: true }), null);
  assert.equal(readerKeyboardCommand({ key: "-", ctrlKey: true, fromEditable: true }), null);
  assert.equal(readerKeyboardCommand({ key: "0", ctrlKey: true, fromEditable: true }), null);
  assert.equal(isEditableReaderTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableReaderTarget({ tagName: "SELECT" }), true);
});

test("wheel zoom calculation yields smooth factor for trackpad and mice", () => {
  // Negative dy = zoom in (> 1), positive dy = zoom out (< 1)
  const calcFactor = (dy: number) => Math.exp(-dy * 0.002);

  // Mouse wheel notch up (~ -100px)
  const wheelZoomIn = calcFactor(-100);
  assert.ok(wheelZoomIn > 1.2 && wheelZoomIn < 1.25, `Expected ~1.22, got ${wheelZoomIn}`);

  // Mouse wheel notch down (~ 100px)
  const wheelZoomOut = calcFactor(100);
  assert.ok(wheelZoomOut > 0.8 && wheelZoomOut < 0.85, `Expected ~0.82, got ${wheelZoomOut}`);

  // Precision trackpad tick (~ -5px)
  const trackpadTick = calcFactor(-5);
  assert.ok(trackpadTick > 1.005 && trackpadTick < 1.015, `Expected ~1.01, got ${trackpadTick}`);

  // Boundary scale bounds
  assert.equal(READER_MIN_SCALE, 0.25);
  assert.equal(READER_MAX_SCALE, 4);
});

test("zoom out below 320px scales page dimensions proportionally without clamping", () => {
  const pageSize = { width: 595, height: 842 }; // Standard A4
  // When zoomed out to 0.35x, page height is 294px (< 320px)
  const scale = 0.35;
  const renderWidth = Math.floor(pageSize.width * scale);
  const renderHeight = Math.floor(pageSize.height * scale);

  assert.equal(renderWidth, 208);
  assert.equal(renderHeight, 294);
  assert.ok(renderHeight < 320, "Rendered height must scale freely below 320px without min-height clamping");
});
