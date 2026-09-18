import type { DocumentSearchMatch, PageTextItem } from "@weaveforge/core";
import { locateMention } from "./reference-locate";

/** One tick on the scrollbar strip: where in the document (0–1) a match sits. */
export interface FindMark {
  /** Index into the match list, so the current one can be drawn differently. */
  index: number;
  /** Fraction of the whole document, top to bottom. */
  fraction: number;
}

/**
 * Where each match falls in the document, as a fraction of its full height,
 * for the ticks beside the scrollbar. Pages are taken as equal in height —
 * true for nearly every paper, and a tick a few pixels off on a mixed-size
 * document still lands on the right page.
 *
 * A match whose page text is not loaded yet sits at the top of its page; the
 * strip repaints once the text arrives.
 */
export function findMarks(
  matches: readonly DocumentSearchMatch[],
  numPages: number,
  itemsForPage: (pageNumber: number) => readonly PageTextItem[] | undefined,
  pageHeightFor: (pageNumber: number) => number,
): FindMark[] {
  if (numPages <= 0) return [];
  return matches.map((match, index) => {
    const pageNumber = match.pageIndex + 1;
    let within = 0;
    const items = itemsForPage(pageNumber);
    const height = pageHeightFor(pageNumber);
    if (items && height > 0) {
      const { bounds } = locateMention(items, match.start, match.end);
      // PDF y runs upward; the top of the box is `bounds[3]`.
      if (bounds) within = Math.min(1, Math.max(0, 1 - bounds[3] / height));
    }
    return { index, fraction: (match.pageIndex + within) / numPages };
  });
}
