/**
 * The colour a stored stroke is drawn in, worked out at render time so a page
 * reads in any theme without rewriting a byte:
 *
 * - a palette token ("text", "red", ...) resolves through the live theme;
 * - a hex on, or within 0.02 OKLab of, a Paper slot draws as that slot's token;
 * - any other hex is canonical (as drawn on Paper) and is mapped to the theme
 *   (`mapInkColour`);
 * - anything else is passed through as CSS.
 *
 * `canonicalInkColour` is the way back: a colour picked in a theme becomes the
 * Paper hex that draws as it.
 */

import { INK_COLOURS, type InkColour } from "@weaveforge/core";
import { differenceEuclidean, parseHex } from "culori";
import { readyCore } from "@/lib/rust-core";
import type { InkPalette, InkRgb } from "./parts-1";
import { mapInkColour, PAPER_INK_SLOTS, PAPER_INK_THEME, type InkTheme } from "./map-ink-colour";

/** The live theme as ink sees it: token palette plus the map's page, text and accents. */
export interface ThemeInk {
  palette: InkPalette;
  theme: InkTheme;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SLOT_RADIUS = 0.02;
const deltaE = differenceEuclidean("oklab");
const ACCENT_TOKENS = ["accent", "info", "good", "warn", "danger"] as const satisfies readonly InkColour[];

function rgbOf(hex: string): InkRgb {
  const c = parseHex(hex)!;
  return [c.r, c.g, c.b];
}

/** The Paper slots as a token palette: what a mark stores when its colour must not depend on the theme. */
export const PAPER_INK_PALETTE = Object.fromEntries(
  INK_COLOURS.map((name) => [name, rgbOf(PAPER_INK_SLOTS[name])]),
) as InkPalette;

export function isInkToken(colour: string): colour is InkColour {
  return (INK_COLOURS as readonly string[]).includes(colour);
}

/** The theme the map works in, read off a palette and the page background hex. */
export function inkThemeOf(palette: InkPalette, background: string): InkTheme {
  const hex = (name: InkColour) => readyCore().paletteHex(palette, name);
  return { bg: background.toLowerCase(), fg: hex("text"), accents: ACCENT_TOKENS.map(hex) };
}

function nearestSlot(hex: string): InkColour | null {
  let best: InkColour | null = null;
  let bestDistance = SLOT_RADIUS;
  for (const name of INK_COLOURS) {
    const d = deltaE(hex, PAPER_INK_SLOTS[name]);
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}

export function resolveInkColour(stored: string, ink: ThemeInk): string {
  if (isInkToken(stored)) return readyCore().paletteHex(ink.palette, stored);
  if (!HEX.test(stored)) return stored;
  const hex = stored.toLowerCase();
  if (ink.theme === PAPER_INK_THEME) return hex;
  const slot = nearestSlot(hex);
  return slot ? readyCore().paletteHex(ink.palette, slot) : mapInkColour(hex, PAPER_INK_THEME, ink.theme);
}

export function canonicalInkColour(picked: string, theme: InkTheme): string {
  return mapInkColour(picked.toLowerCase(), theme, PAPER_INK_THEME);
}
