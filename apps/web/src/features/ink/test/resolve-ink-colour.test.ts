/**
 * A stored stroke colour is resolved at render time, so a page reads in any
 * theme without rewriting a byte: a token through the live palette, a hex on
 * (or a hair from) a Paper slot as that slot in the current theme, any other
 * hex mapped from Paper to the theme. A colour picked in a theme is stored as
 * its Paper (canonical) equivalent.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { differenceEuclidean, oklch, parseHex } from "culori";

import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";
import { mapInkColour, PAPER_INK_SLOTS, PAPER_INK_THEME, type InkTheme } from "../render/map-ink-colour";
import { INK_RENDER_COLOURS, type InkPalette } from "../render/parts-1";
import {
  canonicalInkColour,
  inkThemeOf,
  PAPER_INK_PALETTE,
  resolveInkColour,
  type ThemeInk,
} from "../render/resolve-ink-colour";

before(loadTestCore);

const rgb = (hex: string): [number, number, number] => {
  const c = parseHex(hex)!;
  return [c.r, c.g, c.b];
};
const DARK_PALETTE: InkPalette = {
  ...INK_RENDER_COLOURS,
  text: rgb("#e7ebf1"),
  accent: rgb("#7aa2e3"),
  info: rgb("#7cc4de"),
  good: rgb("#7fc79a"),
  warn: rgb("#d6a860"),
  danger: rgb("#e08a80"),
};
const DARK: ThemeInk = { palette: DARK_PALETTE, theme: inkThemeOf(DARK_PALETTE, "#14171c") };
const PAPER: ThemeInk = { palette: INK_RENDER_COLOURS, theme: PAPER_INK_THEME };
const deltaE = differenceEuclidean("oklab");

test("the theme is read off the palette: text is fg, accent and status tokens are the accents", () => {
  const theme: InkTheme = DARK.theme;
  assert.equal(theme.bg, "#14171c");
  assert.equal(theme.fg, "#e7ebf1");
  assert.deepEqual(theme.accents, ["#7aa2e3", "#7cc4de", "#7fc79a", "#d6a860", "#e08a80"]);
});

test("a token resolves through the theme's palette", () => {
  assert.equal(resolveInkColour("text", DARK), "#e7ebf1");
  assert.equal(resolveInkColour("danger", DARK), "#e08a80");
});

test("a hex on or a hair from a Paper slot draws as that slot in the theme", () => {
  assert.equal(resolveInkColour("#2b2924", DARK), "#e7ebf1");
  assert.equal(resolveInkColour("#2c2a25", DARK), "#e7ebf1");
  assert.equal(resolveInkColour("#a4443a", DARK), "#e08a80");
  assert.equal(resolveInkColour("#FFD400", DARK), "#ffd400", "markers are fixed in every theme");
});

test("any other hex is mapped from Paper to the theme", () => {
  assert.equal(resolveInkColour("#6a2b8c", DARK), mapInkColour("#6a2b8c", PAPER_INK_THEME, DARK.theme));
  assert.ok(oklch(resolveInkColour("#000000", DARK))!.l > 0.85, "black ink shows on the dark page");
});

test("on Paper a stored hex draws as itself", () => {
  for (const hex of ["#6a2b8c", "#000000", "#123456"]) assert.equal(resolveInkColour(hex, PAPER), hex);
});

test("a colour that is neither a token nor a hex is passed through", () => {
  assert.equal(resolveInkColour("rebeccapurple", DARK), "rebeccapurple");
});

test("a colour picked in a theme is stored canonical and draws back as picked", () => {
  for (const picked of ["#e7ebf1", "#c08040", "#5f9fd0"]) {
    const stored = canonicalInkColour(picked, DARK.theme);
    assert.ok(deltaE(resolveInkColour(stored, DARK), picked) <= 0.02, `${picked} -> ${stored}`);
  }
  assert.equal(canonicalInkColour("#E7EBF1", PAPER.theme), "#e7ebf1");
});

test("the Paper palette names each slot by its canonical hex, both ways", () => {
  for (const [name, hex] of Object.entries(PAPER_INK_SLOTS)) {
    const colour = name as keyof typeof PAPER_INK_SLOTS;
    assert.equal(readyCore().paletteHex(PAPER_INK_PALETTE, colour), hex);
    assert.equal(readyCore().paletteName(PAPER_INK_PALETTE, hex), colour);
  }
});
