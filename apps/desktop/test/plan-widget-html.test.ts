import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// The widget is a local file with no network, so the app's Rubik never
// reached it and it drew in the system font (design D16). It carries its own.
test("the widget is set in Rubik, bundled with it and allowed by its CSP", () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.match(csp, /font-src [^;]*file:/, "the bundled font may load");
  assert.doesNotMatch(csp, /font-src [^;]*https?:/, "and nothing off the network");
  for (const file of ["rubik-latin.woff2", "rubik-latin-ext.woff2"]) {
    assert.match(style, new RegExp(`@font-face \\{[^}]*font-family: "Rubik";[^}]*url\\("fonts/${file.replace(".", "\\.")}"\\)`), file);
    assert.ok(existsSync(new URL(`../src/fonts/${file}`, import.meta.url)), `${file} ships with the source`);
  }
  assert.ok(existsSync(new URL("../src/fonts/OFL.txt", import.meta.url)), "with its licence");
  assert.match(style, /--font: Rubik,/, "Rubik before the app sends its font");
  const build = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(build, /cpSync\(path\.join\(root, "src\/fonts"\), path\.join\(root, "dist\/fonts"\)/, "the build copies the fonts");
});

// A palette saved before the shape crossed over has colours only. Until the
// app resends it, the widget drew a flat, shadowless card (design D16).
test("before the app sends its shape, the card is lifted, not flat", () => {
  const root = style.slice(style.indexOf(":root {"), style.indexOf("}", style.indexOf(":root {")));
  assert.doesNotMatch(root, /--sh: none;/);
  assert.doesNotMatch(root, /--sh-sm: none;/);
  assert.match(root, /--sh: [^;]*color-mix\(in srgb, CanvasText/);
});
