import { pdfRectToScreenBox, type PageProjection, type ReaderAnnotation } from "@weaveforge/core";

/** One comment card in the writing margin beside a page, and where it sits. */
export interface MarginNote {
  annotation: ReaderAnnotation;
  /** Screen offset from the top of the page, after stacking. */
  top: number;
  /** Where the mark it belongs to starts, before stacking — for the leader line. */
  anchorTop: number;
}

/** Height a card is assumed to take before it is measured; stacking uses it. */
export const MARGIN_NOTE_HEIGHT = 64;
const GAP = 8;

/** The top of an annotation's first mark on screen, or null when it has none. */
function markTop(annotation: ReaderAnnotation, projection: PageProjection): number | null {
  const position = annotation.anchor.zoteroPosition;
  if (!position) return null;
  let top = Number.POSITIVE_INFINITY;
  for (const rect of position.rects ?? []) {
    if (rect.length < 4) continue;
    const box = pdfRectToScreenBox([rect[0]!, rect[1]!, rect[2]!, rect[3]!], projection);
    top = Math.min(top, box.top);
  }
  for (const path of position.paths ?? []) {
    let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < path.length; i += 2) {
      x0 = Math.min(x0, path[i]!); x1 = Math.max(x1, path[i]!);
      y0 = Math.min(y0, path[i + 1]!); y1 = Math.max(y1, path[i + 1]!);
    }
    if (x0 <= x1) top = Math.min(top, pdfRectToScreenBox([x0, y0, x1, y1], projection).top);
  }
  return Number.isFinite(top) ? top : null;
}

/**
 * The comments on one page, laid out down the margin beside it: each card
 * level with the mark it annotates, pushed down only as far as the card
 * above it needs. Marks without a comment are not shown — the margin is for
 * what was said about the page, and the highlight itself is already on it.
 */
export function layoutMarginNotes(
  annotations: readonly ReaderAnnotation[],
  projection: PageProjection,
  cardHeight = MARGIN_NOTE_HEIGHT,
): MarginNote[] {
  const placed: MarginNote[] = [];
  for (const annotation of annotations) {
    if (!annotation.comment.trim()) continue;
    const top = markTop(annotation, projection);
    if (top === null) continue;
    placed.push({ annotation, top, anchorTop: top });
  }
  placed.sort((a, b) => a.anchorTop - b.anchorTop);
  let floor = 0;
  for (const note of placed) {
    note.top = Math.max(note.anchorTop, floor);
    floor = note.top + cardHeight + GAP;
  }
  return placed;
}
