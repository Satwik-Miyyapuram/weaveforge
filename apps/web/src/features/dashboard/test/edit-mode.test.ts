/**
 * Edit mode gave no hint of what to do, "Reset default" threw the layout away
 * with no way back, and each card's drag handle and ✕ were 13 px glyphs
 * (design D22, DA-130). Edit mode now says how it works, Reset layout can be
 * undone from its toast (rule D-07: undo first), ✕ is an IconButton, and the
 * handle is a full-size grip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const bar = read("ui/dashboard-edit-bar.tsx");
const screen = read("ui/dashboard-screen.tsx");
const grid = read("ui/dashboard-grid.tsx");
const css = readFileSync(fileURLToPath(new URL("../../../app/styles/dashboard.css", import.meta.url)), "utf8");

test("edit mode says how it works", () => {
  assert.match(screen, /\{editing && \(\s*<p className="muted dashboard-edit-hint">Drag a card to move it, drag its corner to resize, or remove it with ✕\. Done saves\.<\/p>/);
});

test("Reset layout can be undone instead of asked about", () => {
  assert.doesNotMatch(bar, /Reset default/);
  assert.match(bar, />\s*Reset layout\s*</);
  assert.match(screen, /showToast\("Layout reset", \{ label: "Undo", run: \(\) => setLayout\(before\) \}\)/);
});

test("a card's ✕ is a CloseButton and its handle a full-size grip", () => {
  assert.match(grid, /<CloseButton\s+size="sm"\s+label=\{`Remove \$\{def\.label\}`\}/);
  assert.match(grid, /<span className="dashboard-drag-handle" title="Drag to move" aria-hidden>\s*<GripIcon \/>/);
  assert.match(css, /\.dashboard-drag-handle \{[^}]*width: var\(--control-lg\);[^}]*height: var\(--control-lg\);/);
  assert.doesNotMatch(css, /\.dashboard-card-remove \{[^}]*padding: 0 2px/, "the IconButton keeps its own size");
});

test("a card looks the same in edit mode: one heading, controls laid over it", () => {
  // The heading was swapped for a bold label row in edit mode, which moved
  // every card's content down and clipped it (round 3, home edit vs normal).
  assert.match(grid, /<h3 className="dashboard-card-heading">\{def\.label\}<\/h3>/);
  assert.doesNotMatch(grid, /!editing && <h3/);
  assert.doesNotMatch(grid, /dashboard-card-label/);
  assert.match(css, /\.dashboard-card-chrome \{[^}]*position: absolute;/);
});

test("the edit bar takes the Customize button's place in the title row", () => {
  assert.doesNotMatch(css, /\.head-row:has\(\.dashboard-edit-bar--editing\)/);
  assert.doesNotMatch(css, /\.dashboard-edit-bar--editing \{/);
});
