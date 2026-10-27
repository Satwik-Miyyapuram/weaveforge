import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The widget page kept Poster's look in every theme: its fallback colours were
 * hard-coded hex, and its 2px border, hard shadow and corners never changed
 * (design D-27, DA-145). Everything it draws now reads a variable the app sends.
 */
const html = readFileSync(new URL("../src/plan-widget.html", import.meta.url), "utf8");
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

test("no colour is hard-coded: the fallback is the system's own colours", () => {
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(style, /\brgba?\(|\boklch\(/i);
  assert.match(style, /color-scheme: light dark/);
  assert.match(style, /--bg: Canvas;/);
});

test("corners, border, shadows, font and sizes come from the theme", () => {
  for (const name of ["radius", "radius-sm", "bw", "sh", "sh-sm", "font", "fs", "fs-sm"]) {
    assert.match(style, new RegExp(`var\\(--${name}\\)`), name);
  }
  assert.doesNotMatch(style, /border(-[a-z]+)?: 2px/, "no fixed Poster border");
  assert.doesNotMatch(style, /border-radius: \d/, "no fixed corner");
  assert.doesNotMatch(style, /font-size: \d/, "no fixed text size");
});

test("the palette is applied as sent, so a theme change repaints an open widget", () => {
  assert.match(html, /for \(const \[key, value\] of Object\.entries\(palette\)\) root\.setProperty\(`--\$\{key\}`, value\);/);
  assert.doesNotMatch(html, /setProperty\("--sh/, "the shadow is the theme's, not one made from the line colour");
});

test("the CRT tilt stays off in the widget", () => {
  assert.doesNotMatch(style, /rotate|perspective|skew/);
});
