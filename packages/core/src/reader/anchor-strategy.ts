import type { PdfLocus } from "./pdf-locus.js";

/**
 * Zotero `annotationPosition` shape, defined structurally in core so web can
 * map onto it without inverting the dependency rule.
 */
export interface ZoteroRectPosition {
  /** Zero-based page index from Zotero. */
  pageIndex: number;
  /** PDF user-space rects `[x1, y1, x2, y2]`. */
  rects?: number[][];
}

/**
 * Dual anchor: Zotero rects for write-back interop, W3C locus for durability.
 * `contentHash` is the PDF the rects were captured against (caller-supplied).
 */
export interface CombinedPdfAnchor {
  /** Hash of the PDF file the Zotero rects were captured against. */
  contentHash?: string;
  /** Zotero page/rects — trustworthy only while the hash still matches. */
  zoteroPosition?: ZoteroRectPosition;
  /** W3C quote (+ optional position) for re-resolution across files. */
  locus?: PdfLocus;
}

export type AnchorStrategy =
  | { kind: "rects"; position: ZoteroRectPosition; confidence: "high" }
  | { kind: "quote"; locus: PdfLocus; confidence: "low" }
  | { kind: "none"; confidence: "low" };

/**
 * Choose which anchor to trust for the current PDF.
 * Use rects only when `currentContentHash` matches the capture hash; otherwise
 * fall back to quote with low confidence. Never silently trust rects against a
 * different file.
 */
export function chooseAnchorStrategy(
  anchor: CombinedPdfAnchor,
  currentContentHash: string,
): AnchorStrategy {
  const rects = anchor.zoteroPosition;
  const hasRects =
    rects != null &&
    Number.isFinite(rects.pageIndex) &&
    rects.pageIndex >= 0 &&
    Array.isArray(rects.rects) &&
    rects.rects.length > 0;

  const hashMatches =
    Boolean(anchor.contentHash) &&
    Boolean(currentContentHash) &&
    anchor.contentHash === currentContentHash;

  if (hasRects && hashMatches) {
    return { kind: "rects", position: rects!, confidence: "high" };
  }

  if (anchor.locus?.quote?.exact) {
    return { kind: "quote", locus: anchor.locus, confidence: "low" };
  }

  return { kind: "none", confidence: "low" };
}
