import { test } from "node:test";
import assert from "node:assert/strict";

import { commandForChord, isTypingTarget, shortcutTable } from "../application/keybindings";

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

test("⌘E toggles the document between Edit and Read", () => {
  assert.equal(commandForChord({ key: "e", metaKey: true }), "toggle-mode");
  assert.equal(commandForChord({ key: "E", ctrlKey: true }), "toggle-mode");
  assert.equal(commandForChord({ key: "e" }), null);
});

test("⌘N asks for a new note", () => {
  assert.equal(commandForChord({ key: "n", metaKey: true }), "new-note");
  assert.equal(commandForChord({ key: "N", ctrlKey: true }), "new-note");
  assert.equal(commandForChord({ key: "b", metaKey: true }), "toggle-explorer");
  assert.equal(commandForChord({ key: "F", metaKey: true, shiftKey: true }), "toggle-focus");
  assert.equal(commandForChord({ key: "f", ctrlKey: true }), null);
  assert.equal(commandForChord({ key: "n" }), null);
});

test("the shortcut table lists every command exactly once", () => {
  const table = shortcutTable();
  const commands = Object.keys(table);
  assert.equal(new Set(commands).size, commands.length);
  // Everything `commandForChord` can return must have a printable chord, or the
  // empty state's grid would silently omit a command the shell accepts.
  for (const command of ["quick-open", "toggle-mode", "split-right", "close-tab", "next-tab", "previous-tab"]) {
    assert.ok(table[command as keyof typeof table], `${command} has no chord`);
  }
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

test("⌘1–⌘8 jump to that tab and ⌘9 to the last, as in a browser", () => {
  assert.equal(commandForChord({ key: "1", ctrlKey: true }), "tab-1");
  assert.equal(commandForChord({ key: "8", metaKey: true }), "tab-8");
  assert.equal(commandForChord({ key: "9", ctrlKey: true }), "last-tab");
  // ⌘0 is the host's "reset zoom"; a shifted digit is a symbol, not a tab.
  assert.equal(commandForChord({ key: "0", ctrlKey: true }), null);
  assert.equal(commandForChord({ key: "1", ctrlKey: true, shiftKey: true }), null);
  assert.equal(commandForChord({ key: "1" }), null);
  assert.equal(shortcutTable()["tab-1"], "⌘1");
  assert.equal(shortcutTable()["last-tab"], "⌘9");
});
