/**
 * Ink palette colour maths and contact area (Rust `ink_palette`), re-exported from index.ts.
 * A palette crosses as its `[name, [r, g, b]]` pairs, in key order.
 */
import {
  contactAreaMm2 as rawContactAreaMm2,
  paletteCss as rawPaletteCss,
  paletteHex as rawPaletteHex,
  paletteName as rawPaletteName,
  parseCssColour as rawParseCssColour,
  samePalette as rawSamePalette,
} from "../pkg/wf_wasm.js";

/** A palette as the object the renderers read (name to `[r, g, b]`, each 0..1), as ordered pairs. */
function paletteEntries<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
): [K, [number, number, number]][] {
  return (Object.keys(palette) as K[]).map((name) => [name, [...palette[name]]]);
}

/** One palette entry as a CSS colour: `rgb(...)` at alpha 1 or more, else `rgba(...)`. */
export function paletteCss<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  colour: string,
  alpha: number,
): string {
  return rawPaletteCss(paletteEntries(palette), colour, alpha);
}

/** One palette entry as `#rrggbb`. */
export function paletteHex<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  colour: string,
): string {
  return rawPaletteHex(paletteEntries(palette), colour);
}

/** The palette name a hex colour was written from, or `null`. */
export function paletteName<K extends string>(
  palette: Readonly<Record<K, readonly [number, number, number]>>,
  hex: string,
): K | null {
  return (rawPaletteName(paletteEntries(palette), hex) as K | undefined) ?? null;
}

/** Parse a computed CSS colour to `[r, g, b]` in 0..1, or `null` for one it does not read. */
export function parseCssColour(value: string): [number, number, number] | null {
  const rgb = rawParseCssColour(value);
  return rgb ? [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0] : null;
}

/** Whether two palettes draw the same. */
export function samePalette<K extends string>(
  a: Readonly<Record<K, readonly [number, number, number]>>,
  b: Readonly<Record<K, readonly [number, number, number]>>,
): boolean {
  return rawSamePalette(paletteEntries(a), paletteEntries(b));
}

/** A touch's contact area in mm², from its CSS-pixel box. A missing side counts as 0. */
export function contactAreaMm2(event: { width?: number; height?: number }): number {
  return rawContactAreaMm2(event.width ?? 0, event.height ?? 0);
}
