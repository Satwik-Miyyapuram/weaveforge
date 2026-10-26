/** The dashboard's customize button shows its icon at full size (E43). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = (f: string) => readFileSync(fileURLToPath(new URL(`../../../app/styles/${f}`, import.meta.url)), "utf8");

test("the customize button beats the shared button padding", () => {
  // states.css pads every button at :root:root weight; a plain .class rule loses.
  assert.match(css("states.css"), /\.dashboard-customize-btn/);
  assert.match(css("dashboard.css"), /:root:root \.dashboard-customize-btn \{ padding: 0; \}/);
  assert.match(css("dashboard.css"), /\.dashboard-customize-btn svg \{ flex: none; \}/);
});
