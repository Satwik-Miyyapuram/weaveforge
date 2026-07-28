import { normaliseWhitespace } from "./anchor-resolution.js";
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
  /** Ink strokes — flat `[x,y,x,y,…]` point lists in PDF user space. */
  paths?: number[][];
  /** Tail of a highlight that crosses onto the next page. */
  nextPageRects?: number[][];
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

function hasUsableRects(rects: ZoteroRectPosition | undefined): rects is ZoteroRectPosition {
  if (
    rects == null ||
    !Number.isInteger(rects.pageIndex) ||
    rects.pageIndex < 0 ||
    !Array.isArray(rects.rects) ||
    rects.rects.length === 0
  ) {
    return false;
  }
  return rects.rects.some(
    (rect) =>
      Array.isArray(rect) &&
      rect.length >= 4 &&
      rect.slice(0, 4).every((n) => typeof n === "number" && Number.isFinite(n)),
  );
}

function hasUsableQuote(locus: PdfLocus | undefined): boolean {
  const exact = locus?.quote?.exact;
  if (exact == null) return false;
  return normaliseWhitespace(exact).normalised.length > 0;
}

/**
 * Choose which anchor to trust for the current PDF.
 * Use rects when:
 * - both hashes are present and match, or
 * - both hashes are empty (local annotation on the current unnamed PDF).
 * Never silently trust rects against a different file.
 */
export function chooseAnchorStrategy(
  anchor: CombinedPdfAnchor,
  currentContentHash: string,
): AnchorStrategy {
  const captureHash = anchor.contentHash?.trim() ?? "";
  const currentHash = currentContentHash.trim();
  const bothEmpty = !captureHash && !currentHash;
  const hashMatches =
    bothEmpty || (Boolean(captureHash) && Boolean(currentHash) && captureHash === currentHash);

  if (hasUsableRects(anchor.zoteroPosition) && hashMatches) {
    return { kind: "rects", position: anchor.zoteroPosition, confidence: "high" };
  }

  if (hasUsableQuote(anchor.locus)) {
    return { kind: "quote", locus: anchor.locus!, confidence: "low" };
  }

  return { kind: "none", confidence: "low" };
}
