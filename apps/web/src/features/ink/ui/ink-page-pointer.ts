import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";

/**
 * The page's pointer plumbing: the cursor each tool shows, the capture an
 * eraser sweep or a lasso loop takes and releases, and the polyline the lasso's
 * SVG draws. Nothing here knows the page's state; it is what the handlers reach
 * for.
 */

/** The eraser's cursor: a tilted eraser block, hot spot at the rubbing edge. */
export const ERASER_CURSOR =
  'url("data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M8.5 21L2.8 15.3a1.6 1.6 0 0 1 0-2.3L13 2.8a1.6 1.6 0 0 1 2.3 0l5.9 5.9a1.6 1.6 0 0 1 0 2.3L11.2 21z" fill="#fff" stroke="#222" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M2.8 15.3L8.5 21h2.7l3.5-3.5-6.9-6.9-5 5z" fill="#f28b82" stroke="#222" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M12 21h9" stroke="#222" stroke-width="1.5" stroke-linecap="round"/>' +
      "</svg>",
  ) +
  '") 5 19, crosshair';

/** The dot cursor's size bounds in CSS px: always findable, never past the 128px browsers accept. */
const DOT_MIN = 4;
const DOT_MAX = 64;

/**
 * The pen's and the highlighter's cursor: the ink itself, a dot the colour,
 * size and opacity of the stroke it will lay down, so the nib is its own
 * preview. A thin light and dark double ring keeps it visible on any page and
 * against any ink; the hot spot is its centre.
 */
export function inkDotCursor(hex: string, diameterPx: number, alpha = 1): string {
  const d = Math.min(DOT_MAX, Math.max(DOT_MIN, Number.isFinite(diameterPx) ? diameterPx : DOT_MIN));
  const size = Math.ceil(d + 4);
  const c = size / 2;
  const r = d / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${r + 1}" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${hex}" fill-opacity="${alpha}" stroke="#222" stroke-opacity="0.7" stroke-width="0.75"/>` +
    "</svg>";
  const hot = Math.round(c);
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${hot} ${hot}, crosshair`;
}

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

/** The ink a pen or highlighter will lay down: its colour and its nib on screen. */
export interface InkCursorInk {
  hex: string;
  /** The nib's width in CSS px at the current zoom. */
  diameterPx: number;
}

/**
 * The pointer for a tool, with the ink in hand when there is one: the pen and
 * the highlighter show their own dot, every other tool its shape from the table.
 */
export function inkToolCursor(tool: keyof typeof INK_TOOL_CURSORS, ink?: InkCursorInk): string {
  if (ink && (tool === "pen" || tool === "highlighter")) {
    return inkDotCursor(ink.hex, ink.diameterPx, tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1);
  }
  return INK_TOOL_CURSORS[tool];
}

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

