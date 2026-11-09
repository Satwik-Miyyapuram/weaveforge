/** Types for anchor-strategy. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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
  /**
   * Nib width for `paths`, in PDF units — Zotero's own ink field, so it
   * round-trips. One width per annotation rather than per point: see
   * `ink-stroke.ts` for why pressure is applied per stroke.
   */
  width?: number;
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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface AnchorStrategyFns {
  /**
 * Choose which anchor to trust for the current PDF.
 * Use rects when:
 * - both hashes are present and match, or
 * - both hashes are empty (local annotation on the current unnamed PDF).
 * Never silently trust rects against a different file.
 */
  chooseAnchorStrategy(anchor: CombinedPdfAnchor, currentContentHash: string): AnchorStrategy;
}
