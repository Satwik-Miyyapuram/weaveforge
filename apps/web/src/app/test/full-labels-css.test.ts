/**
 * Labels the reader needs whole were cut to an ellipsis at tablet and phone
 * width: the project name heading the dashboard, the paper titles an AI
 * suggestion cites, and the "Not started" status on a report section.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = (name: string) => readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), "utf8");

/** Declarations of every rule whose selector list is exactly `selector`. */
function rules(src: string, selector: string): string[] {
  return src
    .split("}")
    .map((chunk) => chunk.split("{"))
    .flatMap(([head, body]) => (body !== undefined && head?.trim().split("\n").pop()?.trim() === selector ? [body] : []));
}

test("the dashboard title wraps instead of ending in an ellipsis", () => {
  const all = rules(css("dashboard.css"), ".dashboard-screen .screen-title").join("\n");
  assert.doesNotMatch(all, /white-space:\s*nowrap/);
  assert.doesNotMatch(all, /text-overflow:\s*ellipsis/);
});

test("a cited source shows its title on up to two lines", () => {
  const [rule = ""] = rules(css("ai-review.css"), ".ai-review-source");
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  assert.match(rule, /-webkit-line-clamp:\s*2/);
  assert.match(rule, /max-width:\s*100%/);
});

test("a report section's status select fits its longest label", () => {
  // One width for every value, wide enough for "Not started" in the CRT face.
  const desktop = rules(css("sections.css"), ".section-item .entity-card-status :is(.status-select, .custom-select-container)").join("\n");
  assert.match(desktop, /width:\s*9rem/);
  assert.doesNotMatch(css("dashboard.css"), /\.report-screen \.section-item \.custom-select-container \{[^}]*width:\s*7\.5rem/);
});
