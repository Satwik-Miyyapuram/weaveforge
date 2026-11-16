/**
 * Sizes and view maths for the freeform page. Pure: no DOM, no React, so the
 * node tests can check every rule without a browser.
 */

export const TEXT_WIDTH = 320;
export const PICTURE_MAX_WIDTH = 640;
export const MIN_SIZE = 40;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
const TEXT_HEIGHT = 40;

/** The page's pan and zoom: a page point `p` shows at screen `x + p.x * zoom`. */
export interface PageView {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Where a new text box goes: at the pointer, on whole page pixels. */
export function placeText(at: { x: number; y: number }): Size & { x: number; y: number } {
  return { x: Math.round(at.x), y: Math.round(at.y), width: TEXT_WIDTH, height: TEXT_HEIGHT };
}

/** A picture's starting size: its natural size, capped at 640 wide, aspect kept. */
export function pictureSize(natural: Size): Size {
  const width = Math.max(MIN_SIZE, natural.width);
  const height = Math.max(MIN_SIZE, natural.height);
  if (width <= PICTURE_MAX_WIDTH) return { width: Math.round(width), height: Math.round(height) };
  return { width: PICTURE_MAX_WIDTH, height: Math.round((height * PICTURE_MAX_WIDTH) / width) };
}

/** A corner drag: the width follows the drag, the height follows the width, neither below the minimum. */
export function resizeKeepAspect(start: Size, dx: number): Size {
  const ratio = start.height / start.width;
  let width = Math.max(MIN_SIZE, Math.round(start.width + dx));
  let height = Math.round(width * ratio);
  if (height < MIN_SIZE) {
    height = MIN_SIZE;
    width = Math.round(height / ratio);
  }
  return { width, height };
}

/** A right-edge drag: only the width changes, never below the minimum. */
export function resizeWidth(startWidth: number, dx: number): number {
  return Math.max(MIN_SIZE, Math.round(startWidth + dx));
}

/** A screen point (relative to the surface) as a page point. */
export function screenToPage(view: PageView, screen: { x: number; y: number }): { x: number; y: number } {
  return { x: (screen.x - view.x) / view.zoom, y: (screen.y - view.y) / view.zoom };
}

/** Zooms by `factor` around the screen point, so the page point under it stays put. */
export function zoomAt(view: PageView, screen: { x: number; y: number }, factor: number): PageView {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom * factor));
  const page = screenToPage(view, screen);
  return { zoom, x: screen.x - page.x * zoom, y: screen.y - page.y * zoom };
}
