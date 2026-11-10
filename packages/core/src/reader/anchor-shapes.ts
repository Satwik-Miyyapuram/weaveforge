/**
 * Structural copies of the anchor shapes core still reads. Core cannot import
 * `@weaveforge/wasm`, so these mirror `packages/wf-wasm/src/reader-types.ts`; the Rust
 * core (crates/wf-core) is the authority. The TS anchor logic is gone.
 */

/** Primary anchor: quote + optional context (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** Fallback anchor: character offsets into extracted text (W3C TextPositionSelector). */
export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/** A stored locus for jump-to-source. */
export interface PdfLocus {
  quote: TextQuoteSelector;
  position?: TextPositionSelector;
}

/** Character span in extracted text, UTF-16 offsets. */
export interface TextSpan {
  start: number;
  end: number;
}

export type AnchorConfidence = "high" | "low";

export interface ResolvedAnchor extends TextSpan {
  via: "quote" | "position";
  confidence: AnchorConfidence;
}

/** Zotero `annotationPosition` shape. */
export interface ZoteroRectPosition {
  pageIndex: number;
  rects?: number[][];
  paths?: number[][];
  width?: number;
  nextPageRects?: number[][];
}

/** Dual anchor: Zotero rects for write-back, W3C locus for durability. */
export interface CombinedPdfAnchor {
  contentHash?: string;
  zoteroPosition?: ZoteroRectPosition;
  locus?: PdfLocus;
}
