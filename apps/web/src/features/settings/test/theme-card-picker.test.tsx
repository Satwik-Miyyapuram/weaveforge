import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** One theme is chosen at a time, so every option is a radio and looks like one (DA-17). */
const options = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "brutal", label: "Poster" },
  { id: "crt", label: "CRT" },
  { id: "amoled", label: "AMOLED" },
];

test("theme options are round radios, never checkbox-styled", async () => {
  const { ThemeCardPicker } = await import("../ui/theme-card-picker");
  const html = renderToStaticMarkup(
    createElement(ThemeCardPicker, { name: "t", labelledBy: "h", options, value: "amoled", onChange: () => {} }),
  );
  assert.match(html, /role="radiogroup"/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, options.length);
  assert.equal((html.match(/class="wf-radio"/g) ?? []).length, options.length);
  assert.doesNotMatch(html, /themed-check/);
});

test("a chosen chip shows more than an outline", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/appearance.css", import.meta.url)), "utf8");
  const at = css.indexOf("\n.theme-chip.is-on {");
  assert.ok(at >= 0);
  assert.match(css.slice(at, css.indexOf("}", at)), /background:\s*var\(--accent-soft\)/);
});

test("a chip's hidden radio takes no room, so the swatch sits at the chip's edge", () => {
  // `:root:root .wf-radio` (0,3,0) made the radio relative again, leaving an
  // empty 18px slot plus a gap before the swatch; this rule must outrank it.
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/appearance.css", import.meta.url)), "utf8");
  const rule = css.match(/:root:root \.theme-chip > \.wf-radio \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /position:\s*absolute/);
});
