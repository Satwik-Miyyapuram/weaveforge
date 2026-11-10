import { type PageProjection, type ReaderAnnotation } from "@weaveforge/core";
import { layoutMarginNotes as layoutMarks, picturePath, type MarginMark, type MarginSlot } from "@weaveforge/wasm";

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

/** The annotation's zotero position as the layout reads it, or null when it has none. */
function markGeometry(annotation: ReaderAnnotation): MarginMark["geometry"] {
  const position = annotation.anchor.zoteroPosition;
  if (!position) return null;
  return { rects: position.rects ?? [], paths: position.paths ?? [] };
}

/**
 * The comments on one page, laid out down the margin beside it: each card
 * level with the mark it annotates, pushed down only as far as the card
 * above it needs. Marks without a comment are not shown — the margin is for
 * what was said about the page, and the highlight itself is already on it.
 * The rules live in Rust (`layoutMarginNotes`); this maps annotations to marks.
 */
export function layoutMarginNotes(
  annotations: readonly ReaderAnnotation[],
  projection: PageProjection,
  cardHeight = MARGIN_NOTE_HEIGHT,
): MarginNote[] {
  const marks: MarginMark[] = annotations.map((annotation) => ({
    hasComment: annotation.comment.trim().length > 0,
    // A placed picture keeps its file in the comment; it is drawn on the page, not in the margin.
    hasPicture: Boolean(picturePath(annotation)),
    geometry: markGeometry(annotation),
  }));
  return layoutMarks(marks, projection, cardHeight).map((slot: MarginSlot) => ({
    annotation: annotations[slot.index]!,
    // Rust f64 comes back null only for NaN; keep the old NaN.
    top: slot.top ?? Number.NaN,
    anchorTop: slot.anchorTop ?? Number.NaN,
  }));
}
