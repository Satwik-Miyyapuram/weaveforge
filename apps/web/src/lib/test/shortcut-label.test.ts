import assert from "node:assert/strict";
import test from "node:test";

import { readyCore } from "@/lib/rust-core";

test("Windows and Linux read Ctrl, Shift and Alt, joined with + (E29)", () => {
  assert.equal(readyCore().shortcutLabel("⌘⇧F", false), "Ctrl+Shift+F");
  assert.equal(readyCore().shortcutLabel("⌘Z", false), "Ctrl+Z");
  assert.equal(readyCore().shortcutLabel("⌘⇧⇥", false), "Ctrl+Shift+Tab");
  assert.equal(readyCore().shortcutLabel("⌥⌘\\", false), "Alt+Ctrl+\\");
  assert.equal(readyCore().shortcutLabel("⌃C", false), "Ctrl+C");
});

test("a function key is one cap, with or without modifiers", () => {
  assert.equal(readyCore().shortcutLabel("F11", false), "F11");
  assert.equal(readyCore().shortcutLabel("F2", false), "F2");
  assert.equal(readyCore().shortcutLabel("⌘⇧F2", false), "Ctrl+Shift+F2");
});

test("a Mac keeps its glyphs", () => {
  assert.equal(readyCore().shortcutLabel("⌘⇧F", true), "⌘⇧F");
  assert.equal(readyCore().keyLabel("⌘", true), "⌘");
});

test("one keycap reads as a word off a Mac", () => {
  assert.equal(readyCore().keyLabel("⌘", false), "Ctrl");
  assert.equal(readyCore().keyLabel("⇧", false), "Shift");
  assert.equal(readyCore().keyLabel("⇥", false), "Tab");
  assert.equal(readyCore().keyLabel("P", false), "P");
});
