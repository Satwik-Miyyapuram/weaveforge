import assert from "node:assert/strict";
import test from "node:test";

import { isPenMode, toolOnPenApproach } from "../ui/use-ink-prefs";

/**
 * Picking the pen up selects a pen mode.
 *
 * The rule, as the product states it: bringing the pen to the screen selects the
 * pen — but a pen mode that is *already* selected stays, because a hover precedes
 * every stroke and a highlighter that reverted to the pen on every hover would be
 * unusable. Otherwise it returns to the last pen mode the user chose, so putting
 * the pen down to pick something and picking it up again resumes what they were
 * doing.
 *
 * The subtlety this test exists for: "last pen mode" is a **separate fact** from
 * "the tool in force". With the eraser up, the tool in force is not a pen mode, so
 * the answer cannot be recovered from it — which is why `useInkPrefs` keeps it in
 * its own ref.
 */
test("a pen mode already selected is left alone", () => {
  // The hover case, and the one that matters most: hover precedes every stroke, so
  // a highlighter must survive it.
  assert.equal(toolOnPenApproach("pen", "pen"), "pen");
  assert.equal(toolOnPenApproach("highlighter", "pen"), "highlighter");
  // And the remembered mode does not override the one in force.
  assert.equal(toolOnPenApproach("highlighter", "highlighter"), "highlighter");
});

test("a non-drawing tool returns to the last pen mode chosen", () => {
  assert.equal(toolOnPenApproach("eraser", "pen"), "pen");
  assert.equal(toolOnPenApproach("eraser", "highlighter"), "highlighter");
  assert.equal(toolOnPenApproach("lasso", "pen"), "pen");
  assert.equal(toolOnPenApproach("lasso", "highlighter"), "highlighter");
  // The shape tool is not a pen mode either: it draws a shape, not ink.
  assert.equal(toolOnPenApproach("shape", "pen"), "pen");
  assert.equal(toolOnPenApproach("shape", "highlighter"), "highlighter");
});

test("pen is the default when no pen mode has been chosen", () => {
  // `useInkPrefs` seeds the ref with "pen", so this is the first-ever-approach case.
  assert.equal(toolOnPenApproach("eraser", "pen"), "pen");
});

test("only pen and highlighter are pen modes", () => {
  assert.equal(isPenMode("pen"), true);
  assert.equal(isPenMode("highlighter"), true);
  assert.equal(isPenMode("eraser"), false);
  assert.equal(isPenMode("lasso"), false);
  assert.equal(isPenMode("shape"), false);
});
