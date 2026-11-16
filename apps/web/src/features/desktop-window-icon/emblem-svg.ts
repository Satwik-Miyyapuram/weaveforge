/**
 * Recolours the emblem source for a raster. Its style block reads the page's
 * `--logo-ink` and `--logo-accent`; the running icon replaces each use with the
 * colour picked for the taskbar, so the rendered icon is the same for any theme.
 */

import type { IconColours } from "./window-icon-colours";

const INK_VAR = /var\(--logo-ink, [^)]*\)/g;
const ACCENT_VAR = /var\(--logo-accent, [^)]*\)/g;

/** The emblem SVG text with its ink and accent variables replaced by literal colours. */
export function recolourEmblem(svg: string, colours: IconColours): string {
  return svg.replace(INK_VAR, colours.ink).replace(ACCENT_VAR, colours.dot);
}
