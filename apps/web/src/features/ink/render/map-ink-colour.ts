/**
 * Theme-relative ink colours. A stored stroke hex is canonical: the colour as
 * it looks on the light Paper theme. `mapInkColour(hex, from, to)` carries it
 * between themes in OKLCH, in closed form:
 *
 * - lightness keeps its place between page and text:
 *   t = (L - L_bg,from) / (L_fg,from - L_bg,from), L' = L_bg,to + t (L_fg,to - L_bg,to);
 * - chroma scales with the theme's accents, C' = C k_to / k_from, where
 *   k = mean accent chroma / Paper's mean accent chroma, capped at 1 on a dark
 *   page (Helmholtz-Kohlrausch: saturated colours already look brighter there);
 * - hue is kept; an out-of-gamut result loses chroma along its hue line.
 *
 * Paper maps to itself exactly, and swapping the themes inverts the map, so a
 * colour picked in any theme is stored canonical and round-trips. See
 * docs/building/ink-colours.md for the laws and related work.
 */

import type { InkColour } from "@weaveforge/core";
import { clampChroma, differenceEuclidean, formatHex, oklch, type Oklch } from "culori";

export interface InkTheme {
  /** Page background, `#rrggbb`. */
  bg: string;
  /** Body text, `#rrggbb`. */
  fg: string;
  /** Accent and status tokens; their mean chroma sets how colourful ink is. */
  accents: readonly string[];
}

/**
 * Every ink slot's value on Paper: the canonical colour space. Theme slots
 * come from themes/light.css; the eight markers are fixed in every theme
 * (styles/editor-workspace.css).
 */
export const PAPER_INK_SLOTS: Readonly<Record<InkColour, string>> = {
  text: "#2b2924",
  accent: "#3b5b8c",
  info: "#2f6f8f",
  good: "#3d7650",
  warn: "#8d6224",
  danger: "#a4443a",
  yellow: "#ffd400",
  red: "#ff6666",
  green: "#5fb236",
  blue: "#2ea8e5",
  purple: "#a28ae5",
  pink: "#e56eee",
  orange: "#f19837",
  grey: "#aaaaaa",
};

export const PAPER_INK_THEME: InkTheme = {
  bg: "#f4f1ea",
  fg: PAPER_INK_SLOTS.text,
  accents: [PAPER_INK_SLOTS.accent, PAPER_INK_SLOTS.info, PAPER_INK_SLOTS.good, PAPER_INK_SLOTS.warn, PAPER_INK_SLOTS.danger],
};

const deltaE = differenceEuclidean("oklab");
const lightness = (hex: string) => oklch(hex)?.l ?? 0;
const meanChroma = (theme: InkTheme) =>
  theme.accents.length === 0
    ? 0
    : theme.accents.reduce((sum, a) => sum + (oklch(a)?.c ?? 0), 0) / theme.accents.length;

/** How colourful a theme's ink is relative to Paper's. */
function chromaScale(theme: InkTheme): number {
  const paper = meanChroma(PAPER_INK_THEME);
  const k = paper > 0 && theme.accents.length > 0 ? meanChroma(theme) / paper : 1;
  return lightness(theme.bg) < 0.5 ? Math.min(k, 1) : k;
}

function sameTheme(a: InkTheme, b: InkTheme): boolean {
  return a.bg === b.bg && a.fg === b.fg && a.accents.join() === b.accents.join();
}

const hueGap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/**
 * Rounds to 8-bit sRGB: the hex (within 2 steps per channel of the nearest)
 * closest to the target in OKLab whose hue stays within 2 degrees of the
 * target's. Plain per-channel rounding can swing the hue several degrees near
 * grey or the gamut edge, and its error is amplified on the way back.
 */
function toHex(target: Oklch): string {
  const nearest = formatHex(target);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(nearest.slice(i, i + 2), 16)) as [number, number, number];
  const keepsHue = (hex: string) => {
    const c = oklch(hex);
    return target.h === undefined || (c?.c ?? 0) <= 0.02 || hueGap(c?.h ?? 0, target.h) <= 2;
  };
  let best = nearest;
  let bestScore = keepsHue(nearest) ? deltaE(nearest, target) : Infinity;
  for (let dr = -2; dr <= 2; dr++)
    for (let dg = -2; dg <= 2; dg++)
      for (let db = -2; db <= 2; db++) {
        const rgb = [r + dr, g + dg, b + db];
        if (rgb.some((v) => v < 0 || v > 255)) continue;
        const hex = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        const score = deltaE(hex, target);
        if (score < bestScore && keepsHue(hex)) {
          best = hex;
          bestScore = score;
        }
      }
  return best;
}

const cache = new Map<string, string>();

export function mapInkColour(hex: string, from: InkTheme, to: InkTheme): string {
  const colour = oklch(hex);
  if (!colour) return hex;
  if (sameTheme(from, to)) return formatHex(colour);
  const fromBg = lightness(from.bg);
  const toBg = lightness(to.bg);
  const span = lightness(from.fg) - fromBg;
  const t = span === 0 ? 1 : (colour.l - fromBg) / span;
  const l = Math.min(1, Math.max(0, toBg + t * (lightness(to.fg) - toBg)));
  const c = (colour.c ?? 0) * (chromaScale(to) / chromaScale(from));
  const key = `${hex}|${JSON.stringify(from)}|${JSON.stringify(to)}`;
  let out = cache.get(key);
  if (out === undefined) {
    if (cache.size > 4096) cache.clear();
    out = toHex(clampChroma({ mode: "oklch", l, c, h: colour.h }, "oklch") as Oklch);
    cache.set(key, out);
  }
  return out;
}
