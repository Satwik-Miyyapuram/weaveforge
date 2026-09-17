/**
 * The page's pointer plumbing: the eraser's cursor, the capture an eraser sweep
 * or a lasso loop takes and releases, and the polyline the lasso's SVG draws.
 * Nothing here knows the page's state; it is what the handlers reach for.
 */

/** The eraser's cursor: a ring the size of a fingertip, hot spot at its centre. */
export const ERASER_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.55)" stroke="#333" stroke-width="1.5"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="#333"/>' +
      "</svg>",
  ) +
  '") 12 12, crosshair';

/** Where each touch is, in client pixels, while it is down. */
export type TouchPoint = { x: number; y: number };

/**
 * Take the pointer for an eraser sweep or a lasso loop. The same two steps the
 * pen path takes on a draw: without `preventDefault` Chromium on Windows reads a
 * pen-down as the start of a platform gesture, revokes the capture a few pixels
 * in and sends `pointercancel`, so the sweep erases one point and the loop never
 * closes. Capture can throw for a pointer the browser no longer tracks; that is
 * not worth aborting the handler over.
 */
export function claimPointer(event: React.PointerEvent<HTMLCanvasElement>): void {
  event.preventDefault();
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Already released or synthetic: the sweep still works without capture.
  }
}

export function releasePointer(event: React.PointerEvent<HTMLCanvasElement>): void {
  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  } catch {
    // Nothing to release.
  }
}

/** `x,y x,y …` for a polyline, from a flat list. */
export function pointsAttribute(path: readonly number[]): string {
  let out = "";
  for (let i = 0; i + 1 < path.length; i += 2) {
    out += `${path[i]},${path[i + 1]} `;
  }
  return out.trim();
}

