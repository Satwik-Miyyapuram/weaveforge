/** Types for reader-viewport. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * Pure viewport math for the PDF reader.
 *
 * Anchors live in PDF user space; screen coordinates are derived at render
 * time from scale + rotation. Keeping this logic framework-free means zoom /
 * fit / rotate can be unit-tested without pdf.js or a DOM.
 */

export type ReaderFitMode = "width" | "page" | "custom";

export type ReaderRotation = 0 | 90 | 180 | 270;

export interface ReaderPageSize {
  /** PDF page width in PDF user-space units (at scale 1, rotation 0). */
  width: number;
  /** PDF page height in PDF user-space units (at scale 1, rotation 0). */
  height: number;
}

export interface ReaderContainerSize {
  width: number;
  height: number;
}

export interface ReaderViewportState {
  scale: number;
  fit: ReaderFitMode;
  rotation: ReaderRotation;
  /** 1-based current page. */
  page: number;
}

/** Default zoom when the container size is unknown. */
const READER_DEFAULT_SCALE = 1;

export const READER_MIN_SCALE = 0.25;

export const READER_MAX_SCALE = 4;

const READER_ZOOM_STEP = 1.25;

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ReaderViewportFns {
  clampScale(scale: number): number;
  /**
 * Scale so the page width fills the container (with a small gutter).
 * Uses the rotated page's visual width.
 */
  computeFitWidthScale(page: ReaderPageSize, container: ReaderContainerSize, rotation?: ReaderRotation, gutterPx?: number): number;
  /**
 * Scale so the whole page fits inside the container (letterbox).
 */
  computeFitPageScale(page: ReaderPageSize, container: ReaderContainerSize, rotation?: ReaderRotation, gutterPx?: number): number;
  visualPageSize(page: ReaderPageSize, rotation: ReaderRotation): ReaderPageSize;
  /**
 * A live gesture's zoom factor, kept so `baseScale * factor` stays within the
 * reader's scale limits. A base scale that is not a positive number gives 1.
 */
  clampZoomFactor(factor: number, baseScale: number): number;
  zoomIn(scale: number, step?: number): number;
  zoomOut(scale: number, step?: number): number;
  nextRotation(current: ReaderRotation, delta?: 90 | -90): ReaderRotation;
  /** Clamp a 1-based page number into [1, numPages]. */
  clampPage(page: number, numPages: number): number;
  /**
 * Resolve the effective render scale for the current fit mode.
 * `custom` returns the stored scale unchanged (still clamped).
 */
  resolveViewportScale(state: Pick<ReaderViewportState, "scale" | "fit" | "rotation">, page: ReaderPageSize, container: ReaderContainerSize): number;
  initialReaderViewport(page?: number): ReaderViewportState;
}
