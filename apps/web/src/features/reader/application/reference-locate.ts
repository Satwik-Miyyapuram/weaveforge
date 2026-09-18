/**
 * Turn mention character offsets into page geometry.
 *
 * `findCitationMentions` and `findFigureMentions` report offsets into the page
 * text, which is the concatenation of the page's text runs with a newline after
 * every `hasEOL` run — the same string `buildPageText` produces and the same
 * convention core's `absoluteOffset` / `itemToRect` assume. Getting that
 * convention wrong shifts every mention after the first line break onto the
 * wrong run, so it is pinned by a test rather than left to inspection.
 *
 * Output is PDF user space, like stored annotation rects; the overlay projects
 * it to CSS pixels. Nothing here touches the DOM, so the maths is testable
 * without a PDF.
 */

import { itemToRect, type PageTextItem } from "@weaveforge/core";

/** `[x0, y0, x1, y1]` in PDF user space, origin bottom-left. */
export type PdfRect = [number, number, number, number];

export interface MentionGeometry {
  /** One rect per text run the mention spans, in reading order. */
  rects: PdfRect[];
  /** Union of `rects`, for anchoring a control to the whole mention. */
  bounds: PdfRect | null;
}

const EMPTY: MentionGeometry = { rects: [], bounds: null };

/**
 * The page's runs as the one string the finders report offsets into: every run
 * concatenated, with a newline after each `hasEOL` run.
 *
 * This is the same convention as `pdf-document.buildPageText` (which the reader
 * uses for search text and anchors) — `reference-locate.test.ts` asserts the two
 * agree, because a divergence here would put every mention after a line break on
 * the wrong run, silently.
 */
export function pageTextFromItems(items: readonly { str: string; hasEOL?: boolean }[]): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}

/**
 * Rects covering `[start, end)` of the page text. Out-of-range or empty ranges
 * yield no geometry rather than a guess, so a stale offset paints nothing
 * instead of highlighting an unrelated line.
 */
export function locateMention(
  items: readonly PageTextItem[],
  start: number,
  end: number,
): MentionGeometry {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return EMPTY;

  const rects: PdfRect[] = [];
  let cursor = 0;
  for (const item of items) {
    const length = item.str.length;
    const itemStart = cursor;
    const itemEnd = cursor + length;
    // The newline `buildPageText` appends occupies a character in the page text
    // but has no glyph run, so it advances the cursor without producing a rect.
    cursor = itemEnd + (item.hasEOL ? 1 : 0);

    if (length === 0 || itemEnd <= start || itemStart >= end) continue;

    const from = Math.max(0, start - itemStart);
    const to = Math.min(length, end - itemStart);
    const rect = itemToRect(item, from, to) as PdfRect | null;
    if (rect) rects.push(rect);
  }

  return rects.length ? { rects, bounds: unionRect(rects) } : EMPTY;
}

/** Smallest rect containing every input rect, or null when given none. */
export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
  if (!rects.length) return null;
  let [x0, y0, x1, y1] = rects[0]!;
  for (const rect of rects) {
    x0 = Math.min(x0, rect[0]);
    y0 = Math.min(y0, rect[1]);
    x1 = Math.max(x1, rect[2]);
    y1 = Math.max(y1, rect[3]);
  }
  return [x0, y0, x1, y1];
}
