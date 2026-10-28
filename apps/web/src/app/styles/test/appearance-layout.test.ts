/**
 * Settings → Appearance sits in the same card as the other settings panels,
 * so it keeps the card's padding: an override of 4px sides and 48px bottom
 * left the theme cards touching the edges and a gap under the last section.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(path.join(app, "styles/appearance.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  for (const [, sel = "", body = ""] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.trim() === selector) return body;
  }
  return "";
}

test("the appearance panel keeps the card's own padding", () => {
  assert.ok(rule(".appearance"), "rule exists");
  assert.doesNotMatch(rule(".appearance"), /padding/);
});

test("the last section leaves no gap above the card's bottom edge", () => {
  assert.match(rule(".appearance-section:last-child"), /margin-bottom: 0/);
});
