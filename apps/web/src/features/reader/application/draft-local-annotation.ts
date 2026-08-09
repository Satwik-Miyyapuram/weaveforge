import {
  buildAnnotationSortIndex,
  clampInkWidth,
  compactInkPath,
  INK_DEFAULT_WIDTH,
  INK_MAX_PATHS_PER_ANNOTATION,
  selectionToAnchor,
  type CombinedPdfAnchor,
  type NewReaderAnnotation,
  type PageTextGeometry,
  type ReaderAnnotationType,
  type TextSelectionRange,
} from "@weaveforge/core";

export function draftFromTextSelection(input: {
  type: Extract<ReaderAnnotationType, "highlight" | "underline" | "note">;
  color: string;
  selection: TextSelectionRange;
  page: PageTextGeometry;
  comment?: string;
}): NewReaderAnnotation | null {
  const anchor = selectionToAnchor(input.selection, input.page);
  if (!anchor) return null;
  const quote = anchor.locus?.quote?.exact ?? "";
  const charStart = anchor.locus?.position?.start ?? 0;
  const top =
    anchor.zoteroPosition?.rects?.[0] != null
      ? input.page.pageHeight - Math.max(anchor.zoteroPosition.rects[0][1]!, anchor.zoteroPosition.rects[0][3]!)
      : 0;
  return {
    type: input.type,
    color: input.color,
    text: quote,
    comment: input.comment ?? "",
    pageIndex: input.page.pageIndex,
    anchor,
    sortIndex: buildAnnotationSortIndex(input.page.pageIndex, charStart, top),
  };
}

export function draftInkAnnotation(input: {
  color: string;
  pageIndex: number;
  pageHeight: number;
  /** Flat `[x,y,…]` PDF user-space path, as captured. */
  path: number[];
  /** Nib width in PDF units; a highlighter is simply a wide one. */
  width?: number;
}): NewReaderAnnotation | null {
  // Compact before storing, never after: the raw capture is the thing that is
  // hundreds of times larger than the stroke's shape needs (see ink-stroke.ts).
  const path = compactInkPath(input.path);
  if (path.length < 4) return null;
  const ys = path.filter((_, i) => i % 2 === 1);
  const topPdf = Math.max(...ys);
  const top = input.pageHeight - topPdf;
  const anchor: CombinedPdfAnchor = {
    zoteroPosition: {
      pageIndex: input.pageIndex,
      paths: [path],
      width: clampInkWidth(input.width ?? INK_DEFAULT_WIDTH),
    },
  };
  return {
    type: "ink",
    color: input.color,
    text: "",
    pageIndex: input.pageIndex,
    anchor,
    sortIndex: buildAnnotationSortIndex(input.pageIndex, 0, top),
  };
}

/**
 * Add a stroke to an ink annotation that already exists.
 *
 * Strokes drawn as one mark — the three strokes of an "A", a word, a circled
 * paragraph — belong in one annotation. Writing each to its own row meant a
 * sentence cost twenty rows, twenty sidebar entries, and twenty deletes; it also
 * multiplied the per-row overhead (id, timestamps, sort index, sync bookkeeping)
 * by twenty for geometry that is a few dozen bytes.
 *
 * Returns null when the stroke does not belong here — a full annotation, a
 * different page, or nothing drawable — and the caller starts a new one.
 */
export function appendInkStroke(
  anchor: CombinedPdfAnchor,
  path: number[],
): CombinedPdfAnchor | null {
  const position = anchor.zoteroPosition;
  if (!position || !Array.isArray(position.paths)) return null;
  if (position.paths.length >= INK_MAX_PATHS_PER_ANNOTATION) return null;
  const compact = compactInkPath(path);
  if (compact.length < 4) return null;
  return {
    ...anchor,
    zoteroPosition: { ...position, paths: [...position.paths, compact] },
  };
}

export function draftImageRegion(input: {
  color: string;
  pageIndex: number;
  pageHeight: number;
  /** PDF user-space rect `[x1,y1,x2,y2]`. */
  rect: [number, number, number, number];
  /** Minimum width/height in PDF units (default 2). */
  minSize?: number;
}): NewReaderAnnotation | null {
  const [x1, y1, x2, y2] = input.rect;
  const minSize = input.minSize ?? 2;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (width < minSize || height < minSize) return null;
  const top = input.pageHeight - Math.max(y1, y2);
  return {
    type: "image",
    color: input.color,
    text: "",
    pageIndex: input.pageIndex,
    anchor: {
      zoteroPosition: {
        pageIndex: input.pageIndex,
        rects: [[Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]],
      },
    },
    sortIndex: buildAnnotationSortIndex(input.pageIndex, 0, top),
  };
}

export function draftTextBox(input: {
  color: string;
  pageIndex: number;
  pageHeight: number;
  text: string;
  /** PDF user-space point — bottom-left of the text box. */
  x: number;
  y: number;
  width?: number;
  height?: number;
}): NewReaderAnnotation {
  const w = input.width ?? 120;
  const h = input.height ?? 24;
  const top = input.pageHeight - (input.y + h);
  return {
    type: "text",
    color: input.color,
    text: input.text,
    pageIndex: input.pageIndex,
    anchor: {
      zoteroPosition: {
        pageIndex: input.pageIndex,
        rects: [[input.x, input.y, input.x + w, input.y + h]],
      },
      locus: {
        quote: { type: "TextQuoteSelector", exact: input.text },
      },
    },
    sortIndex: buildAnnotationSortIndex(input.pageIndex, 0, top),
  };
}
