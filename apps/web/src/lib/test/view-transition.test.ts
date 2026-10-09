import { test } from "node:test";
import assert from "node:assert/strict";

import { isPlainClick, navTransition, transitionsOn } from "../view-transition";

test("transitions run only with motion on, not reduced, and the API there", () => {
  assert.equal(transitionsOn({ motion: "reactive", reducedMotion: false, supported: true }), true);
  assert.equal(transitionsOn({ motion: undefined, reducedMotion: false, supported: true }), false, "motion setting off");
  assert.equal(transitionsOn({ motion: "reactive", reducedMotion: true, supported: true }), false, "reduced motion");
  assert.equal(transitionsOn({ motion: "reactive", reducedMotion: false, supported: false }), false, "no API");
});

test("only a plain left click is taken over", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainClick(click), true);
  assert.equal(isPlainClick({ ...click, ctrlKey: true }), false, "ctrl opens a new window");
  assert.equal(isPlainClick({ ...click, button: 1 }), false);
  assert.equal(isPlainClick({ ...click, defaultPrevented: true }), false);
});

test("without the API the navigation still happens, straight away", () => {
  let went = 0;
  navTransition("forward", () => went++);
  assert.equal(went, 1);
});
