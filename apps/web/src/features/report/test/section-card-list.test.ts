/**
 * The report outline's titles started at different x (a chevron on parents,
 * nothing on leaves), the status select changed width with its value, a done
 * section looked like any other, and the card menu held only Share and Delete
 * (design D22, DA-143). Leaves keep a chevron-wide spacer, the select has one
 * width, done gets a check and a muted title, and the menu adds Open and Rename.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const card = readFileSync(fileURLToPath(new URL("../ui/section-card.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../../../app/styles/sections.css", import.meta.url)), "utf8");
const phone = readFileSync(fileURLToPath(new URL("../../../app/styles/dashboard.css", import.meta.url)), "utf8");

test("titles in the tree line up: leaves keep a chevron-wide spacer", () => {
  assert.match(card, /inTree\s*\?\s*<span className="section-head-toggle-spacer" aria-hidden \/>/);
  assert.match(card, /<SectionCard\s+section=\{s\}[\s\S]*?\n\s+inTree\n[\s\S]*?\/>/);
  assert.match(css, /\.section-head-toggle-spacer \{[^}]*width: var\(--control-sm\);[^}]*height: var\(--control-sm\);/);
});

test("the status select keeps one width whatever it says", () => {
  assert.match(css, /\.section-item \.entity-card-status :is\(\.status-select, \.custom-select-container\) \{[^}]*width: 8\.25rem;/);
  assert.doesNotMatch(phone, /\.report-screen \.section-item \.custom-select-container \{[^}]*width: auto;/);
});

test("a done section shows a check and a muted title, not a fade", () => {
  assert.match(card, /s\.status === "done" && <span className="section-done-check" aria-hidden>✓ <\/span>/);
  assert.match(css, /\.section-item--done \.entity-card-title \{[^}]*color: var\(--muted\);/);
  assert.doesNotMatch(css, /\.section-item--done[^{]*\{[^}]*opacity/);
});

test("the card menu opens and renames the section", () => {
  assert.match(card, /\{ id: "open", label: "Open", onSelect: \(\) => onOpen\(s\.id\) \}/);
  assert.match(card, /\{ id: "rename", label: "Rename", onSelect: \(\) => setRenaming\(true\) \}/);
  assert.match(card, /manageReportSection\.setTitle\(s\.id, title\)/);
  // Enter saves, Escape cancels, and typing never opens the card.
  assert.match(card, /if \(e\.key === "Enter"\)/);
  assert.match(card, /if \(e\.key === "Escape"\) setRenaming\(false\)/);
  assert.match(card, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
});
