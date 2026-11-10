/**
 * The ink palette: the `INK_COLOURS` as linear-ish sRGB triples the
 * renderers draw with.
 *
 * Strokes store a colour *name* — "text", "accent" — and the name resolves to a
 * value at draw time, so a page written in the light theme reads in the dark
 * one without rewriting a byte (§6.1). The values therefore have to come from
 * the live theme: the host reads the CSS tokens the toolbar swatches are painted
 * with and posts them to the worker, which has no document of its own. What is
 * here is the light theme's defaults, for the first frame and for the tests.
 *
 * The colour maths (CSS and hex, the name lookup, the parse, the palette
 * comparison) is the Rust core's, reached through `readyCore()`. This module
 * keeps the palette data and the DOM read of the theme.
 */

import type { InkColour } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

export type InkRgb = [number, number, number];
export type InkPalette = Record<InkColour, InkRgb>;

/** The light theme's tokens, as the renderer's defaults. */
export const INK_RENDER_COLOURS: InkPalette = {
  text: [0.13, 0.14, 0.16],
  accent: [0.23, 0.42, 0.86],
  warn: [0.85, 0.55, 0.09],
  good: [0.16, 0.6, 0.36],
  info: [0.2, 0.55, 0.72],
  danger: [0.79, 0.24, 0.24],
  // The marker colours, `--ink-*` in base.css: the reader's eight, so a note
  // and a paper written in "yellow" are the same yellow.
  yellow: [1, 0.83, 0],
  red: [1, 0.4, 0.4],
  green: [0.37, 0.7, 0.21],
  blue: [0.18, 0.66, 0.9],
  purple: [0.64, 0.54, 0.9],
  pink: [0.9, 0.43, 0.93],
  orange: [0.95, 0.6, 0.22],
  grey: [0.67, 0.67, 0.67],
};

/** The CSS custom property each ink colour is the value of. */
export const INK_COLOUR_TOKENS: Record<InkColour, string> = {
  text: "--text",
  accent: "--accent",
  warn: "--s-warn",
  good: "--s-good",
  info: "--s-info",
  danger: "--s-danger",
  yellow: "--ink-yellow",
  red: "--ink-red",
  green: "--ink-green",
  blue: "--ink-blue",
  purple: "--ink-purple",
  pink: "--ink-pink",
  orange: "--ink-orange",
  grey: "--ink-grey",
};

/**
 * Read the theme's palette off the document: a probe element is given each
 * token as its colour and the computed value read back, which is the one way
 * to resolve a token through `color-mix()` and friends. Runs on the main
 * thread only; the worker is handed the result.
 */
export function readThemePalette(doc: Document): InkPalette {
  const probe = doc.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  doc.body.appendChild(probe);
  const palette: InkPalette = { ...INK_RENDER_COLOURS };
  try {
    for (const colour of Object.keys(INK_COLOUR_TOKENS) as InkColour[]) {
      probe.style.color = `var(${INK_COLOUR_TOKENS[colour]})`;
      const parsed = readyCore().parseCssColour(getComputedStyle(probe).color);
      if (parsed) palette[colour] = parsed;
    }
  } finally {
    probe.remove();
  }
  return palette;
}
