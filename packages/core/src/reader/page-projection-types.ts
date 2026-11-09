/** Page geometry for PDF-to-screen maths. The maths runs in Rust (`crates/wf-core/src/reader/viewport.rs`). */

export interface PageProjection {
  /** Unrotated page size in PDF user-space units. */
  pageWidth: number;
  pageHeight: number;
  scale: number;
  /** 0, 90, 180 or 270. Other values are normalised. */
  rotation: number;
}
