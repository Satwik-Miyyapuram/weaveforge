/**
 * Nib widths in 0.1 mm — the unit trap §6.3 warns about.
 *
 * The reader's helpers clamp to `[0.75, 24]` PDF units; read as 0.1 mm that turns
 * a 6 mm highlighter into a 2.4 mm pen. These tests exist to keep that from
 * creeping back in through a re-export.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_HIGHLIGHTER_MIN_WIDTH,
  INK_HIGHLIGHTER_WIDTH,
  INK_MAX_WIDTH,
  INK_MIN_WIDTH,
  INK_PEN_WIDTH,
  INK_PEN_WIDTHS,
  INK_PRESSURE_MAX_FACTOR,
  INK_PRESSURE_MIN_FACTOR,
  INK_VELOCITY_TAPER,
  clampInkNoteWidth,
  inkPressureFactor,
  inkVelocityBetween,
  inkVelocityFactor,
  isHighlighterWidth,
  nibWidth,
  strokeBaseWidth,
} from "../../src/ink/width.js";

test("a 6 mm highlighter survives clamping, which the reader's clamp would eat", () => {
  assert.equal(INK_HIGHLIGHTER_WIDTH, 60, "6 mm is 60 tenths of a millimetre");
  assert.equal(clampInkNoteWidth(INK_HIGHLIGHTER_WIDTH), 60);
  assert.equal(clampInkNoteWidth(nibWidth(INK_HIGHLIGHTER_WIDTH, 0.5)), 60);
  // The reader clamps to 24 in its own units; 0.1 mm must not inherit that.
  assert.equal(clampInkNoteWidth(24), 24);
  assert.ok(clampInkNoteWidth(INK_HIGHLIGHTER_WIDTH) > 24);
});

test("a width outside what a nib can be is clamped, and a missing one falls back", () => {
  assert.equal(clampInkNoteWidth(INK_MIN_WIDTH - 1), INK_MIN_WIDTH);
  assert.equal(clampInkNoteWidth(INK_MAX_WIDTH + 1), INK_MAX_WIDTH);
  assert.equal(clampInkNoteWidth(Number.NaN), INK_PEN_WIDTH);
  assert.equal(clampInkNoteWidth(Number.POSITIVE_INFINITY), INK_PEN_WIDTH);
  // A width is a whole number of tenths of a millimetre.
  assert.equal(clampInkNoteWidth(6.4), 6);
  assert.equal(clampInkNoteWidth(6.6), 7);
});

test("the highlighter threshold sits clear of every pen width", () => {
  for (const width of INK_PEN_WIDTHS) {
    assert.equal(isHighlighterWidth(width), false, `${width} is a pen, not a highlighter`);
  }
  assert.equal(isHighlighterWidth(INK_HIGHLIGHTER_MIN_WIDTH - 1), false);
  assert.equal(isHighlighterWidth(INK_HIGHLIGHTER_WIDTH), true);
});

test("pressure leaves the width alone when the device reports none", () => {
  // 0 means "no pressure channel", 0.5 is what a mouse reports with a button down.
  assert.equal(inkPressureFactor(0), 1);
  assert.equal(inkPressureFactor(0.5), 1);
  assert.equal(inkPressureFactor(undefined), 1);
  assert.equal(inkPressureFactor(Number.NaN), 1);
});

test("pressure scales the width between a feather touch and a full press", () => {
  assert.ok(
    Math.abs(inkPressureFactor(0.0001) - INK_PRESSURE_MIN_FACTOR) < 0.001,
    "the lightest reported pressure sits at the floor of the range",
  );
  assert.equal(inkPressureFactor(1), INK_PRESSURE_MAX_FACTOR);
  assert.ok(inkPressureFactor(0.25) < inkPressureFactor(0.75), "heavier is wider");
  assert.ok(inkPressureFactor(2) <= INK_PRESSURE_MAX_FACTOR, "pressure above 1 cannot widen further");
});

test("speed thins a stroke to a floor and no further", () => {
  assert.equal(inkVelocityFactor(0), 1);
  assert.equal(inkVelocityFactor(Number.NaN), 1);
  const half = inkVelocityFactor(2, 4);
  assert.ok(Math.abs(half - (1 - INK_VELOCITY_TAPER / 2)) < 1e-9);
  assert.equal(inkVelocityFactor(4, 4), 1 - INK_VELOCITY_TAPER);
  assert.equal(inkVelocityFactor(400, 4), 1 - INK_VELOCITY_TAPER, "the taper is flat above the knee");
});

test("the rendered width combines both, and stays a nib", () => {
  const base = INK_PEN_WIDTH;
  assert.equal(nibWidth(base, 0.5, 0), base, "a mouse draws at the base width");
  assert.ok(nibWidth(base, 1, 0) > base, "a press widens");
  assert.ok(nibWidth(base, 0.0001, 0) < base, "a feather touch narrows");
  assert.ok(nibWidth(base, 1, 10) < nibWidth(base, 1, 0), "speed thins what pressure widened");
  assert.ok(nibWidth(1000, 1, 0) <= INK_MAX_WIDTH, "no combination exceeds the widest nib");
  assert.ok(nibWidth(0, 0.0001, 0) >= INK_MIN_WIDTH, "nor goes below the thinnest");
});

test("velocity comes from two samples at 120–240 Hz", () => {
  // 30 units (3 mm) in 10 ms (100 Hz) is 3 units/ms.
  assert.equal(inkVelocityBetween(0, 0, 0, 30, 40, 10), 5);
  assert.equal(inkVelocityBetween(10, 10, 100, 10, 10, 140), 0, "a held pen is not moving");
  assert.equal(
    inkVelocityBetween(0, 0, 100, 1, 0, 100),
    Number.POSITIVE_INFINITY,
    "the same timestamp twice is a duplicated sample, treated as infinitely fast",
  );
  assert.equal(inkVelocityBetween(0, 0, 100, 5, 0, 90), 0, "time cannot run backwards");
});

test("a stroke's stored width is derived from its mean pressure", () => {
  assert.equal(strokeBaseWidth([], INK_PEN_WIDTH), INK_PEN_WIDTH, "no samples means no scaling");
  assert.equal(strokeBaseWidth([0, 0, 0], INK_PEN_WIDTH), INK_PEN_WIDTH, "unreported pressure scales nothing");
  assert.equal(strokeBaseWidth([0.5, 0.5], INK_PEN_WIDTH), INK_PEN_WIDTH, "a mouse reports 0.5 throughout");
  assert.ok(strokeBaseWidth([1, 1], INK_PEN_WIDTH) > INK_PEN_WIDTH, "a press stores a wider base");
  // A highlighter is a marker, not a nib: its width is the tool's, so it is
  // stored with no per-point pressure and comes out exactly 6 mm.
  assert.equal(strokeBaseWidth([], INK_HIGHLIGHTER_WIDTH), INK_HIGHLIGHTER_WIDTH);
  assert.equal(nibWidth(INK_HIGHLIGHTER_WIDTH), INK_HIGHLIGHTER_WIDTH);
});
