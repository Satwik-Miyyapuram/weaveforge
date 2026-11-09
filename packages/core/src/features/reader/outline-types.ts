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
  /** Baseline y of the heading; the Rust core reports `null` when it has none. */
  y?: number | null;
  /** Child sections; the Rust core reports `null` when there are none. */
  items?: ReaderOutlineItem[] | null;
}
