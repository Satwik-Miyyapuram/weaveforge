import assert from "node:assert/strict";
import test from "node:test";

import { keyLabel, shortcutLabel } from "../shortcut-label";

test("Windows and Linux read Ctrl, Shift and Alt, joined with + (E29)", () => {
  assert.equal(shortcutLabel("⌘⇧F", false), "Ctrl+Shift+F");
  assert.equal(shortcutLabel("⌘Z", false), "Ctrl+Z");
  assert.equal(shortcutLabel("⌘⇧⇥", false), "Ctrl+Shift+Tab");
  assert.equal(shortcutLabel("⌥⌘\\", false), "Alt+Ctrl+\\");
  assert.equal(shortcutLabel("⌃C", false), "Ctrl+C");
});

test("a Mac keeps its glyphs", () => {
  assert.equal(shortcutLabel("⌘⇧F", true), "⌘⇧F");
  assert.equal(keyLabel("⌘", true), "⌘");
});

test("one keycap reads as a word off a Mac", () => {
  assert.equal(keyLabel("⌘", false), "Ctrl");
  assert.equal(keyLabel("⇧", false), "Shift");
  assert.equal(keyLabel("⇥", false), "Tab");
  assert.equal(keyLabel("P", false), "P");
});
