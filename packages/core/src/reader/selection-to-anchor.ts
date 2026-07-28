import type { CombinedPdfAnchor } from "./anchor-strategy.js";
import type { PdfLocus } from "./pdf-locus.js";

/** One pdf.js text item in PDF user space (origin bottom-left). */
export interface PageTextItem {
  str: string;
  /** pdf.js transform `[a,b,c,d,e,f]` — e,f are the origin of the glyph run. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PageTextGeometry {
  /** Zero-based page index. */
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  items: readonly PageTextItem[];
  contentHash?: string;
}

export interface TextSelectionRange {
  startItemIndex: number;
  startOffset: number;
  endItemIndex: number;
  endOffset: number;
}

/**
 * Convert a text-layer selection into a CombinedPdfAnchor.
 * Pure — no DOM. Rects are PDF user-space; screen projection happens at render.
 */
export function selectionToAnchor(
  selection: TextSelectionRange,
  page: PageTextGeometry,
): CombinedPdfAnchor | null {
  const normalised = normaliseSelection(selection, page.items.length);
  if (!normalised) return null;

  const { startItemIndex, startOffset, endItemIndex, endOffset } = normalised;
  const exact = extractExact(page.items, startItemIndex, startOffset, endItemIndex, endOffset);
  if (!exact.trim()) return null;

  const prefix = contextBefore(page.items, startItemIndex, startOffset, 32);
  const suffix = contextAfter(page.items, endItemIndex, endOffset, 32);
  const charStart = absoluteOffset(page.items, startItemIndex, startOffset);
  const charEnd = absoluteOffset(page.items, endItemIndex, endOffset);

  const locus: PdfLocus = {
    quote: {
      type: "TextQuoteSelector",
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    },
    position: {
      type: "TextPositionSelector",
      start: charStart,
      end: charEnd,
    },
  };

  const rects: number[][] = [];
  for (let i = startItemIndex; i <= endItemIndex; i++) {
    const item = page.items[i]!;
    if (!item.str) continue;
    const rect = itemToRect(item);
    if (rect) rects.push(rect);
  }

  return {
    contentHash: page.contentHash?.trim() || undefined,
    zoteroPosition: {
      pageIndex: page.pageIndex,
      ...(rects.length ? { rects } : {}),
    },
    locus,
  };
}

function normaliseSelection(
  selection: TextSelectionRange,
  itemCount: number,
): TextSelectionRange | null {
  if (itemCount <= 0) return null;
  let { startItemIndex, startOffset, endItemIndex, endOffset } = selection;
  if (
    !Number.isInteger(startItemIndex) ||
    !Number.isInteger(endItemIndex) ||
    startItemIndex < 0 ||
    endItemIndex < 0 ||
    startItemIndex >= itemCount ||
    endItemIndex >= itemCount
  ) {
    return null;
  }
  if (
    startItemIndex > endItemIndex ||
    (startItemIndex === endItemIndex && startOffset > endOffset)
  ) {
    [startItemIndex, startOffset, endItemIndex, endOffset] = [
      endItemIndex,
      endOffset,
      startItemIndex,
      startOffset,
    ];
  }
  if (startItemIndex === endItemIndex && startOffset === endOffset) return null;
  return { startItemIndex, startOffset, endItemIndex, endOffset };
}

function extractExact(
  items: readonly PageTextItem[],
  startItemIndex: number,
  startOffset: number,
  endItemIndex: number,
  endOffset: number,
): string {
  let out = "";
  for (let i = startItemIndex; i <= endItemIndex; i++) {
    const str = items[i]!.str;
    const from = i === startItemIndex ? Math.max(0, startOffset) : 0;
    const to = i === endItemIndex ? Math.min(str.length, endOffset) : str.length;
    out += str.slice(from, to);
    if (i < endItemIndex && items[i]!.hasEOL) out += "\n";
  }
  return out;
}

function contextBefore(
  items: readonly PageTextItem[],
  itemIndex: number,
  offset: number,
  maxChars: number,
): string {
  let out = items[itemIndex]!.str.slice(0, Math.max(0, offset));
  for (let i = itemIndex - 1; i >= 0 && out.length < maxChars; i--) {
    const piece = items[i]!.str + (items[i]!.hasEOL ? "\n" : "");
    out = piece + out;
  }
  return out.slice(-maxChars);
}

function contextAfter(
  items: readonly PageTextItem[],
  itemIndex: number,
  offset: number,
  maxChars: number,
): string {
  let out = items[itemIndex]!.str.slice(Math.max(0, offset));
  for (let i = itemIndex + 1; i < items.length && out.length < maxChars; i++) {
    out += items[i]!.str + (items[i]!.hasEOL ? "\n" : "");
  }
  return out.slice(0, maxChars);
}

function absoluteOffset(
  items: readonly PageTextItem[],
  itemIndex: number,
  offset: number,
): number {
  let total = 0;
  for (let i = 0; i < itemIndex; i++) {
    total += items[i]!.str.length;
    if (items[i]!.hasEOL) total += 1;
  }
  return total + Math.max(0, offset);
}

/**
 * pdf.js text-item transform → axis-aligned PDF user-space rect [x1,y1,x2,y2]
 * with origin bottom-left (Zotero convention).
 */
export function itemToRect(item: PageTextItem): number[] | null {
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return null;
  const x = t[4]!;
  const y = t[5]!;
  const w = item.width;
  const h = item.height || Math.hypot(t[2]!, t[3]!) || 0;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [x, y, x + w, y + h];
}
