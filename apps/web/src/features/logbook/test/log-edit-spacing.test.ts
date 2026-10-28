/**
 * Editing a log entry put the page-level form margin (16px above, 24px below)
 * inside the card's own 16px padding, so the editor sat 32px from the top and
 * 40px from the bottom. Inside a log card the padding alone frames the form.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/entity-detail.css", import.meta.url)), "utf8");

test("the edit form inside a log card adds no margin of its own", () => {
  assert.match(css, /\.log-item > \.add-form \{ margin: 0; \}/);
});
