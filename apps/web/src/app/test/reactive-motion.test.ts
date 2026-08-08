import assert from "node:assert/strict";
import test from "node:test";
import { shouldTrackPointer } from "../reactive-motion";

/**
 * Which devices get the cursor glow.
 *
 * The rule used to read `(pointer: fine)`, which describes the *primary*
 * pointer. On a touchscreen laptop that is the digitiser even with a mouse
 * attached, so the listeners never attached, `--rx`/`--ry` were never written,
 * and the glow sat in the middle of every card — lit, but following nothing.
 */

const on = {
  motion: "reactive",
  reducedMotion: false,
  anyPointerFine: true,
};

test("a touchscreen laptop with a mouse still tracks the pointer", () => {
  // The regression: `(pointer: fine)` is false here, `(any-pointer: fine)` true.
  assert.equal(shouldTrackPointer(on), true);
});

test("a touch-only device does not", () => {
  assert.equal(shouldTrackPointer({ ...on, anyPointerFine: false }), false);
});

test("reduced motion wins over everything", () => {
  assert.equal(shouldTrackPointer({ ...on, reducedMotion: true }), false);
});

test("the user's own setting wins too", () => {
  assert.equal(shouldTrackPointer({ ...on, motion: "calm" }), false);
  assert.equal(shouldTrackPointer({ ...on, motion: undefined }), false);
});
