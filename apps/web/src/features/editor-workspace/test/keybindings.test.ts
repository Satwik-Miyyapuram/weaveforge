import { test } from "node:test";
import assert from "node:assert/strict";

import { commandForChord, isTypingTarget } from "../application/keybindings";

test("Ctrl and Cmd mean the same thing, because both keyboards exist", () => {
  assert.equal(commandForChord({ key: "p", ctrlKey: true }), "quick-open");
  assert.equal(commandForChord({ key: "P", metaKey: true }), "quick-open");
});

test("the shell's four gestures are bound and nothing else is", () => {
  assert.equal(commandForChord({ key: "\\", ctrlKey: true }), "split-right");
  assert.equal(commandForChord({ key: "w", ctrlKey: true }), "close-tab");
  assert.equal(commandForChord({ key: "Tab", ctrlKey: true }), "next-tab");
  assert.equal(commandForChord({ key: "Tab", ctrlKey: true, shiftKey: true }), "previous-tab");
  assert.equal(commandForChord({ key: "q", ctrlKey: true }), null);
});

test("an unmodified key is a keystroke, not a command", () => {
  assert.equal(commandForChord({ key: "p" }), null);
  assert.equal(commandForChord({ key: "w" }), null);
});

test("Alt-modified chords belong to the host, not to us", () => {
  assert.equal(commandForChord({ key: "w", ctrlKey: true, altKey: true }), null);
});

test("a form field swallows shortcuts; the editor surface does not", () => {
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), false);
  assert.equal(isTypingTarget({ tagName: "DIV" }), false);
  assert.equal(isTypingTarget(null), false);
});
