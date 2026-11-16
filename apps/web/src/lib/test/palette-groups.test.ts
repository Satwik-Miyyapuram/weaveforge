import { test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "../rust-core";

// Rows stay the caller's; the core returns indices into them. The footer's key
// chips are UI copy and are not tested here.
const core = readyCore();

type Group = Parameters<typeof core.groupPaletteRows>[0][number];

test("rows group under headings in a fixed order, keeping their order inside a group", () => {
  const groups: Group[] = ["Notes", "Papers", "Actions", "Notes", "Pages", "Recent"];
  assert.deepEqual(core.groupPaletteRows(groups), [
    { label: "Recent", rows: [5] },
    { label: "Pages", rows: [4] },
    { label: "Papers", rows: [1] },
    { label: "Notes", rows: [0, 3] },
    { label: "Actions", rows: [2] },
  ]);
});

test("no rows, no headings", () => {
  assert.deepEqual(core.groupPaletteRows([]), []);
});

test("pages match on their name, and only once something is typed", () => {
  const pages = ["Papers", "Settings", "Plan"];
  assert.deepEqual(core.matchingPageIndices(pages, ""), []);
  assert.deepEqual(core.matchingPageIndices(pages, "  "), []);
  assert.deepEqual(core.matchingPageIndices(pages, "SET"), [1]);
  // A name that starts with the query comes before one that only contains it.
  assert.deepEqual(core.matchingPageIndices(pages, "pa"), [0]);
  assert.deepEqual(core.matchingPageIndices(["Report", "Paper map", "Workspace"], "p"), [1, 0, 2]);
});

const chord = (key: string, over: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key, shiftKey: false, ctrlKey: true, metaKey: false, altKey: false, ...over,
});

test("Ctrl+K and Ctrl+Shift+F open search; Ctrl+Shift+P opens commands", () => {
  assert.equal(core.paletteModeFor(chord("k")), "search");
  assert.equal(core.paletteModeFor(chord("F", { shiftKey: true })), "search");
  assert.equal(core.paletteModeFor(chord("P", { shiftKey: true })), "commands");
  assert.equal(core.paletteModeFor(chord("k", { ctrlKey: false, metaKey: true })), "search");
  // Not the palette's: no modifier, Alt, Ctrl+P (quick open), Ctrl+F (find), Ctrl+Shift+K.
  assert.equal(core.paletteModeFor(chord("k", { ctrlKey: false })), null);
  assert.equal(core.paletteModeFor(chord("k", { altKey: true })), null);
  assert.equal(core.paletteModeFor(chord("p")), null);
  assert.equal(core.paletteModeFor(chord("f")), null);
  assert.equal(core.paletteModeFor(chord("K", { shiftKey: true })), null);
});

test("commands mode lists every command until something is typed, then filters", () => {
  const rows = ["Settings", "New project", "Switch to dark theme"];
  assert.deepEqual(core.commandMatchIndices(rows, ""), [0, 1, 2]);
  assert.deepEqual(core.commandMatchIndices(rows, "  "), [0, 1, 2]);
  assert.deepEqual(core.commandMatchIndices(rows, "pro"), [1]);
  assert.deepEqual(core.commandMatchIndices(rows, "zzz"), []);
});