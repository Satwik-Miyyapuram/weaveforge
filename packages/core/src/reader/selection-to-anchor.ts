/** Types for selection-to-anchor. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { CombinedPdfAnchor } from "./anchor-strategy.js";

/** One pdf.js text item in PDF user space (origin bottom-left). */
export interface PageTextItem {
  str: string;
  /** pdf.js transform `[a,b,c,d,e,f]` — e,f are the origin of the glyph run. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  /** pdf.js font name, when the caller carries it — used for weight checks. */
  fontName?: string;
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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SelectionToAnchorFns {
  /**
 * Convert a text-layer selection into a CombinedPdfAnchor.
 * Pure — no DOM. Rects are PDF user-space; screen projection happens at render.
 */
  selectionToAnchor(selection: TextSelectionRange, page: PageTextGeometry): CombinedPdfAnchor | null;
  /**
 * pdf.js text-item transform → axis-aligned PDF user-space rect [x1,y1,x2,y2]
 * with origin bottom-left (Zotero convention).
 *
 * `charFrom`/`charTo` narrow the rect to a character sub-range, so highlighting
 * one word in a long run does not paint the whole run. pdf.js gives no
 * per-glyph advances here, so the sub-range is interpolated linearly across
 * `item.width` — exact for monospace, close enough elsewhere, and far better
 * than the full-run rect. Out-of-range or reversed bounds fall back to the
 * whole item.
 */
  itemToRect(item: PageTextItem, charFrom?: number, charTo?: number): number[] | null;
}
