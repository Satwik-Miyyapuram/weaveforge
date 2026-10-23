/**
 * The graph settings drawer's layout rules. The tab bar scrolls inside the
 * drawer instead of pushing it wider, the dimmed backdrop stops at the title
 * bar, and option buttons fill the drawer's width.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/graph.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  for (const block of css.split("}")) {
    const open = block.indexOf("{");
    if (open < 0) continue;
    const head = block.slice(0, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (head === selector) return block.slice(open + 1);
  }
  assert.fail(`no rule for ${selector}`);
}

test("the tab bar scrolls sideways instead of overflowing the drawer", () => {
  assert.match(rule(".graph-drawer-tabs"), /overflow-x:\s*auto/);
  assert.match(rule(".graph-drawer-tab"), /flex:\s*1 0 auto/);
});

test("the backdrop leaves the title bar undimmed", () => {
  assert.match(rule(".graph-drawer-backdrop"), /top:\s*var\(--titlebar-h\)/);
});

test("option buttons in the drawer fill its width", () => {
  assert.match(rule(":root:root .graph-settings-drawer .seg"), /display:\s*flex/);
  assert.match(rule(":root:root .graph-settings-drawer .seg > .seg-btn"), /flex:\s*1/);
});

test("every label in the drawer uses one size", () => {
  const size = /font-size:\s*([^;]+);/;
  const sizes = [".graph-drawer-label", ".graph-slider-row", ".graph-settings-drawer label.graph-check", ".graph-drawer-section-head"]
    .map((s) => size.exec(rule(s))?.[1]?.trim());
  assert.equal(new Set(sizes).size, 1, `sizes differ: ${sizes.join(", ")}`);
});
