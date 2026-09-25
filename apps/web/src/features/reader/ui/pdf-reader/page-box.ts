import type { DrawArea } from "../../application/clip-to-area";

/**
 * The rendered page box inside a page's row.
 *
 * The handlers sit on the row (§pdf-reader), because the row's right half is
 * the pen's writing strip and a pointer that lands there must still be
 * measured against the page — the strip is not part of the page. The page box
 * is therefore found inside the row rather than being the event target, and
 * every coordinate below is relative to it.
 */
export function pageBoxOf(row: Element): HTMLElement {
  return (
    row.querySelector<HTMLElement>(".pdf-reader-page") ??
    row.querySelector<HTMLElement>("canvas")?.parentElement ??
    (row as HTMLElement)
  );
}

/**
 * The box a stroke may be drawn in: the page's row, which is the page plus the
 * writing margin beside it. In client pixels, so it is already the zoomed and
 * rotated shape the hand sees.
 *
 * `inset` pulls the box in by that many pixels on every side, and it is the
 * nib's half-width. A stroke is a *centreline* with a nib drawn along it, so
 * cutting the centreline at the edge still paints half a nib past it — a
 * highlighter's half is wide enough to lie in the gap between two pages, which
 * is what "I can draw between the pages" turned out to be. Cutting half a nib
 * inside puts the ink's own edge on the page's edge, which is what a pen on
 * paper does.
 */
export function drawArea(row: Element, inset = 0): DrawArea | null {
  const rect = (row as HTMLElement).getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  // Never so far in that the box disappears on a hairline page.
  const back = Math.min(inset, rect.width / 4, rect.height / 4);
  return {
    left: rect.left + back,
    top: rect.top + back,
    right: rect.right - back,
    bottom: rect.bottom - back,
  };
}
