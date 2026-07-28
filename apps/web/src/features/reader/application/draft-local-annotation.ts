import {
  buildAnnotationSortIndex,
  selectionToAnchor,
  type CombinedPdfAnchor,
  type NewReaderAnnotation,
  type PageTextGeometry,
  type ReaderAnnotationType,
  type TextSelectionRange,
} from "@thesis/core";

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
  /** Flat `[x,y,…]` PDF user-space path. */
  path: number[];
}): NewReaderAnnotation | null {
  if (input.path.length < 4) return null;
  const ys = input.path.filter((_, i) => i % 2 === 1);
  const topPdf = Math.max(...ys);
  const top = input.pageHeight - topPdf;
  const anchor: CombinedPdfAnchor = {
    zoteroPosition: {
      pageIndex: input.pageIndex,
      paths: [input.path],
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
