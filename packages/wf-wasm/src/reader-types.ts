/**
 * Plain TypeScript types for the reader modules whose logic is in Rust. They
 * keep the shapes the deleted TypeScript modules (pdf-locus, reader-viewport) used,
 * so callers that narrow on `quote` keep their types; the generated bindings
 * are looser (every field optional or nullable).
 */
import type { AnchorConfidence, ReaderFitMode, TextSpan } from "./bindings.js";

export type { AnchorConfidence, ReaderFitMode, TextSpan } from "./bindings.js";

/** Primary anchor: quote + optional context snippets (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Fallback anchor: character offsets into extracted page/document text
 * (W3C TextPositionSelector). Brittle across re-extraction; keep as hint.
 */
export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/**
 * A stored locus for jump-to-source. Rects (when present elsewhere) are
 * rendering hints only — never the authoritative anchor.
 */
export interface PdfLocus {
  quote: TextQuoteSelector;
  position?: TextPositionSelector;
}

/** One pdf.js text item in PDF user space (origin bottom-left). */
export interface PageTextItem {
  str: string;
  /** pdf.js transform `[a,b,c,d,e,f]`; e,f are the origin of the glyph run. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  /** pdf.js font name, when the caller carries it. */
  fontName?: string;
}

/** Page text items plus page size, the input to selection-to-anchor. */
export interface PageTextGeometry {
  /** Zero-based page index. */
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  items: readonly PageTextItem[];
  contentHash?: string;
}

/** A text-layer selection, by item index and character offset. */
export interface TextSelectionRange {
  startItemIndex: number;
  startOffset: number;
  endItemIndex: number;
  endOffset: number;
}

/** Smallest zoom the reader allows. */
export const READER_MIN_SCALE = 0.25;

/** Largest zoom the reader allows. */
export const READER_MAX_SCALE = 4;

/** One page's extracted text, as document search reads it. */
export interface DocumentPageText {
  /** Zero-based page index. */
  pageIndex: number;
  text: string;
}

/** A hit in a page's text. Offsets are UTF-16 code units. */
export interface DocumentSearchMatch {
  pageIndex: number;
  /** Inclusive start offset into that page's text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/** Page rotation in degrees. */
export type ReaderRotation = 0 | 90 | 180 | 270;

/** PDF page size in user-space units (at scale 1, rotation 0). */
export interface ReaderPageSize {
  width: number;
  height: number;
}

/** Container size in CSS pixels. */
export interface ReaderContainerSize {
  width: number;
  height: number;
}

/** The reader's zoom, fit and rotation state. */
export interface ReaderViewportState {
  scale: number;
  fit: ReaderFitMode;
  rotation: ReaderRotation;
  page: number;
}

/** A span with how it was found. */
export interface ResolvedAnchor extends TextSpan {
  via: "quote" | "position";
  confidence: AnchorConfidence;
}

/** Zotero `annotationPosition` shape. */
export interface ZoteroRectPosition {
  /** Zero-based page index from Zotero. */
  pageIndex: number;
  /** PDF user-space rects `[x1, y1, x2, y2]`. */
  rects?: number[][];
  /** Ink strokes, flat `[x,y,x,y,...]` point lists in PDF user space. */
  paths?: number[][];
  /** Nib width for `paths`, in PDF units. */
  width?: number;
  /** Tail of a highlight that crosses onto the next page. */
  nextPageRects?: number[][];
}

/** Dual anchor: Zotero rects for write-back interop, W3C locus for durability. */
export interface CombinedPdfAnchor {
  /** Hash of the PDF file the Zotero rects were captured against. */
  contentHash?: string;
  /** Zotero page/rects, trustworthy only while the hash still matches. */
  zoteroPosition?: ZoteroRectPosition;
  /** W3C quote (+ optional position) for re-resolution across files. */
  locus?: PdfLocus;
}

/** Which anchor to trust for the current PDF. */
export type AnchorStrategy =
  | { kind: "rects"; position: ZoteroRectPosition; confidence: "high" }
  | { kind: "quote"; locus: PdfLocus; confidence: "low" }
  | { kind: "none"; confidence: "low" };
