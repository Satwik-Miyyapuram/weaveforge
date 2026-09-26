/**
 * The page's pointer plumbing: the cursor each tool shows, the capture an
 * eraser sweep or a lasso loop takes and releases, and the polyline the lasso's
 * SVG draws. Nothing here knows the page's state; it is what the handlers reach
 * for.
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

/** An SVG cursor with its hot spot, falling back to the crosshair. */
function svgCursor(svg: string, x: number, y: number): string {
  return (
    'url("data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' + svg + "</svg>") +
    `") ${x} ${y}, crosshair`
  );
}

/**
 * A region tool's cursor (the reader's clip and text box): the crosshair,
 * because the corner it is dragged from is the aim.
 */
export const DRAW_CURSOR = "crosshair";

/** The pen: a pencil, hot spot at its point in the bottom-left corner. */
export const PEN_CURSOR = svgCursor(
  '<path d="M3 21l1.2-4.6L16.6 4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L7.6 19.8z" fill="#fff" stroke="#222" stroke-width="1.5" stroke-linejoin="round"/>' +
    '<path d="M4.2 16.4l3.4 3.4" stroke="#222" stroke-width="1.5"/>',
  3,
  21,
);

/** The highlighter: a chisel-tipped marker, hot spot at the tip. */
export const HIGHLIGHTER_CURSOR = svgCursor(
  '<path d="M3 21l2-5 3 3z" fill="#e8c21a" stroke="#222" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M5 16L15.5 5.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19z" fill="#fff" stroke="#222" stroke-width="1.5" stroke-linejoin="round"/>',
  3,
  21,
);

/** The lasso: a dashed loop with its tail, hot spot at the tail's end. */
export const LASSO_CURSOR = svgCursor(
  '<ellipse cx="13" cy="9" rx="8" ry="5.5" fill="rgba(255,255,255,0.55)" stroke="#222" stroke-width="1.5" stroke-dasharray="3 2"/>' +
    '<path d="M8 13.5c-2 1.5-3 4-4.5 7" fill="none" stroke="#222" stroke-width="1.5" stroke-linecap="round"/>',
  3,
  21,
);

/**
 * The pointer each tool shows over the page, by the bar's tool names.
 *
 * One table for both surfaces that carry ink, because a hand that knows what
 * the eraser looks like on a sheet must not find a different one on a paper.
 * Each tool wears its own shape so the one in hand is readable at the nib.
 */
export const INK_TOOL_CURSORS: Record<
  "pen" | "highlighter" | "eraser" | "lasso" | "shape",
  string
> = {
  pen: PEN_CURSOR,
  highlighter: HIGHLIGHTER_CURSOR,
  eraser: ERASER_CURSOR,
  lasso: LASSO_CURSOR,
  shape: DRAW_CURSOR,
};

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

