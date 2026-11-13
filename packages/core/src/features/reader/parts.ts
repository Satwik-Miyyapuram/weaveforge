// --- outline-types ---
/** Shapes for the outline-from-text helpers. The logic runs in Rust (`crates/wf-core/src/reader_analysis/outline.rs`). */
export interface OutlineTextItem {
  str: string;
  fontSize: number;
  fontName?: string;
  x: number;
  y: number;
  page: number;
  /** Set on text not laid out left to right, such as arXiv's vertical side stamp. */
  rotated?: boolean;
}

export interface ReaderOutlineItem {
  title: string;
  pageNumber: number | null;
  /** Baseline y of the heading, absent when it has none. */
  y?: number;
  /** Child sections, absent when there are none. */
  items?: ReaderOutlineItem[];
}

// --- page-text-item ---
/**
 * One pdf.js text item in PDF user space (origin bottom-left). Core cannot import
 * `@weaveforge/wasm`, so this is a structural copy of the shape in
 * `packages/wf-wasm/src/ts-types.ts`; the Rust core is the authority.
 */
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
