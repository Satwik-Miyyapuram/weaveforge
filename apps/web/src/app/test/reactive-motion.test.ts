import assert from "node:assert/strict";
import test from "node:test";
import { shouldTrackPointer } from "../reactive-motion";

/**
 * When the cursor glow tracks the pointer.
 *
 * The rule used to guess at the hardware — first `(pointer: fine)`, which
 * describes the *primary* pointer and so reads as "no mouse" on any touchscreen
 * laptop, then `(any-pointer: fine)`, which was still wrong on the machine that
 * reported it. Both failed the same way: no listener, so `--rx`/`--ry` were
 * never written and the glow sat in the middle of every card, lit and following
 * nothing. The device question is gone; only the two things the user actually
 * chose are left.
 */

const on = { motion: "reactive", reducedMotion: false };

test("tracks whenever reactive motion is on — no hardware guessing", () => {
  assert.equal(shouldTrackPointer(on), true);
});

test("reduced motion wins over the preference", () => {
  assert.equal(shouldTrackPointer({ ...on, reducedMotion: true }), false);
});

test("the user's own setting is respected", () => {
  assert.equal(shouldTrackPointer({ ...on, motion: "calm" }), false);
  assert.equal(shouldTrackPointer({ ...on, motion: undefined }), false);
});
