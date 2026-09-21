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
 */

import type { InkColour } from "@weaveforge/core";

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

/** One palette entry as a CSS colour, for a trail or a Canvas 2D fill. */
export function paletteCss(
  palette: InkPalette,
  colour: InkColour,
  alpha = 1,
): string {
  const [r, g, b] = palette[colour] ?? palette.text ?? INK_RENDER_COLOURS.text;
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255);
  return alpha >= 1
    ? `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
    : `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${alpha})`;
}

/**
 * Parse what `getComputedStyle` answers for a colour: `rgb(r, g, b)`,
 * `rgba(r, g, b, a)`, or the modern `color(srgb r g b)`. Anything else — a
 * token that resolved to nothing — answers `null` so the caller keeps its
 * previous value rather than drawing in black.
 */
export function parseCssColour(value: string): InkRgb | null {
  const text = value.trim();
  let match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (match) {
    return [
      Number(match[1]) / 255,
      Number(match[2]) / 255,
      Number(match[3]) / 255,
    ];
  }
  match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(text);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  match = /^#([0-9a-f]{6})$/i.exec(text);
  if (match) {
    const hex = match[1]!;
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return null;
}

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
      const parsed = parseCssColour(getComputedStyle(probe).color);
      if (parsed) palette[colour] = parsed;
    }
  } finally {
    probe.remove();
  }
  return palette;
}

/** Whether two palettes draw the same, so a theme poll can skip the post. */
export function samePalette(a: InkPalette, b: InkPalette): boolean {
  for (const colour of Object.keys(INK_COLOUR_TOKENS) as InkColour[]) {
    const x = a[colour];
    const y = b[colour];
    if (!x || !y) return false;
    for (let i = 0; i < 3; i += 1) {
      if (Math.abs(x[i]! - y[i]!) > 1 / 512) return false;
    }
  }
  return true;
}
