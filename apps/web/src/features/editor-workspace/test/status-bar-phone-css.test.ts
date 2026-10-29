/**
 * At phone width the status bar ran past the screen: "Markdown" sat half off
 * the right edge. The phone keeps the save state and the headline segments and
 * drops the ones a phone reader does not need in a 26px strip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 479px) {"));

test("the phone status bar hides its secondary segments", () => {
  for (const key of ["chars", "cursor", "encoding", "strokes", "pen"]) {
    assert.match(phone, new RegExp(`\\.status-bar-segment[^{]*data-segment="${key}"[^{]*\\{[^}]*display:\\s*none`), key);
  }
});

test("the phone status bar keeps the headline segments", () => {
  for (const key of ["words", "language", "page", "ink"]) {
    assert.doesNotMatch(phone, new RegExp(`data-segment="${key}"`), key);
  }
});
