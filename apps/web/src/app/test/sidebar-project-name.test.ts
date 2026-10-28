/**
 * The sidebar's project chip and account button share one row. The chip takes
 * the space the button leaves and its name stays on one line, ending in an
 * ellipsis when it is long; wrapping put the button on a second row and made
 * the chip two lines tall.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const nav = readFileSync(fileURLToPath(new URL("../styles/nav.css", import.meta.url)), "utf8");

/** Declarations of every rule whose last selector line is exactly `selector`. */
function rules(selector: string): string {
  return nav
    .split("}")
    .map((chunk) => chunk.split("{"))
    .flatMap(([head, body]) => (body !== undefined && head?.trim().split("\n").pop()?.trim() === selector ? [body] : []))
    .join(";");
}

test("the expanded sidebar keeps the chip and account button in one row", () => {
  assert.doesNotMatch(nav, /\.nav-account-row \{[^}]*flex-wrap:\s*wrap/);
  assert.match(rules(".layout:not(.nav-collapsed) .nav-account-row .proj-switcher"), /flex:\s*1 1 0/);
});

test("a long project name stays on one line and ends in an ellipsis", () => {
  const label = rules(".nav-account-row .proj-chip > span:not(.project-dot)");
  assert.match(label, /white-space:\s*nowrap/);
  assert.match(label, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(label, /line-clamp/);
});
