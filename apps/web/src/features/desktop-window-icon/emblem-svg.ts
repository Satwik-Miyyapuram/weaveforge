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

/** The emblem's box at the taskbar weights, squared, in the source's 512 viewBox. */
const TASKBAR_CROP = "94 90 340 340";

/**
 * The emblem cropped to its own box with thicker strokes, for an icon Windows shows
 * at 24-32 px. The source's 22 / 12 px strokes in a 512 frame fall under a pixel
 * there. Matches the static icon (apps/shell/scripts/build-icons.mjs) at 32 px.
 */
export function taskbarEmblem(svg: string): string {
  if (!svg.includes('viewBox="0 0 512 512"')) throw new Error("The emblem viewBox is not 0 0 512 512.");
  return svg
    .replace('viewBox="0 0 512 512"', `viewBox="${TASKBAR_CROP}"`)
    .replace('stroke-width="22"', 'stroke-width="30"')
    .replace(/stroke-width="12"/g, 'stroke-width="21"')
    .replace(/ r="22"/g, ' r="29"');
}
