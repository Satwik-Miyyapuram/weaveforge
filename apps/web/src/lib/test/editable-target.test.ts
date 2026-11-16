/**
 * One rule for "this target owns its keystrokes" (xhelp-03): the reader, the
 * ink shortcuts and the ink clipboard all ask it.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";

import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

const isEditableTarget = (t: EventTarget | null) => typedCore().isEditableReaderTarget(t);

const el = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable }) as unknown as EventTarget;

test("text fields and pickers own their keys", () => {
  for (const tag of ["INPUT", "TEXTAREA", "SELECT", "OPTION"]) {
    assert.equal(isEditableTarget(el(tag)), true, tag);
  }
});

test("a contenteditable element owns its keys", () => {
  assert.equal(isEditableTarget(el("DIV", true)), true);
});

test("tag names compare without case", () => {
  assert.equal(isEditableTarget(el("input")), true);
});

test("buttons, plain elements and non-elements do not", () => {
  assert.equal(isEditableTarget(el("BUTTON")), false);
  assert.equal(isEditableTarget(el("DIV")), false);
  assert.equal(isEditableTarget(el("CANVAS")), false);
  assert.equal(isEditableTarget({} as EventTarget), false);
  assert.equal(isEditableTarget(null), false);
});
