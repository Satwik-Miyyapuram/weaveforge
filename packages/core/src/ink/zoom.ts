/**
 * The one zoom table for ink: the note canvas and the ink reader, through
 * every input (bar buttons, presets, keys, wheel and pinch).
 */

/** Smallest ink zoom: half size. */
export const INK_ZOOM_MIN = 0.5;
/** Largest ink zoom: four times. */
export const INK_ZOOM_MAX = 4;
/** One zoom-in or zoom-out step, as a factor. */
export const INK_ZOOM_STEP = 1.25;

/** `zoom` kept within the limits; anything not a positive finite number resets to 1. */
export function clampInkZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(INK_ZOOM_MAX, Math.max(INK_ZOOM_MIN, zoom));
}

/** One step in, stopping at the maximum. */
export function inkZoomIn(zoom: number): number {
  return clampInkZoom(zoom * INK_ZOOM_STEP);
}

/** One step out, stopping at the minimum. */
export function inkZoomOut(zoom: number): number {
  return clampInkZoom(zoom / INK_ZOOM_STEP);
}
