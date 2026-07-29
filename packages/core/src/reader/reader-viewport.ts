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
export const READER_DEFAULT_SCALE = 1;

export const READER_MIN_SCALE = 0.25;
export const READER_MAX_SCALE = 4;
export const READER_ZOOM_STEP = 1.25;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return READER_DEFAULT_SCALE;
  return Math.min(READER_MAX_SCALE, Math.max(READER_MIN_SCALE, scale));
}

/**
 * Scale so the page width fills the container (with a small gutter).
 * Uses the rotated page's visual width.
 */
export function computeFitWidthScale(
  page: ReaderPageSize,
  container: ReaderContainerSize,
  rotation: ReaderRotation = 0,
  gutterPx = 24,
): number {
  const visual = visualPageSize(page, rotation);
  const available = Math.max(1, container.width - gutterPx);
  return clampScale(available / Math.max(1, visual.width));
}

/**
 * Scale so the whole page fits inside the container (letterbox).
 */
export function computeFitPageScale(
  page: ReaderPageSize,
  container: ReaderContainerSize,
  rotation: ReaderRotation = 0,
  gutterPx = 24,
): number {
  const visual = visualPageSize(page, rotation);
  const availableW = Math.max(1, container.width - gutterPx);
  const availableH = Math.max(1, container.height - gutterPx);
  const byW = availableW / Math.max(1, visual.width);
  const byH = availableH / Math.max(1, visual.height);
  return clampScale(Math.min(byW, byH));
}

export function visualPageSize(
  page: ReaderPageSize,
  rotation: ReaderRotation,
): ReaderPageSize {
  if (rotation === 90 || rotation === 270) {
    return { width: page.height, height: page.width };
  }
  return { width: page.width, height: page.height };
}

export function zoomIn(scale: number, step = READER_ZOOM_STEP): number {
  return clampScale(scale * step);
}

export function zoomOut(scale: number, step = READER_ZOOM_STEP): number {
  return clampScale(scale / step);
}

export function nextRotation(current: ReaderRotation, delta: 90 | -90 = 90): ReaderRotation {
  const next = (((current + delta) % 360) + 360) % 360;
  return next as ReaderRotation;
}

/** Clamp a 1-based page number into [1, numPages]. */
export function clampPage(page: number, numPages: number): number {
  if (!Number.isFinite(numPages) || numPages < 1) return 1;
  if (!Number.isFinite(page)) return 1;
  return Math.min(numPages, Math.max(1, Math.round(page)));
}

/**
 * Resolve the effective render scale for the current fit mode.
 * `custom` returns the stored scale unchanged (still clamped).
 */
export function resolveViewportScale(
  state: Pick<ReaderViewportState, "scale" | "fit" | "rotation">,
  page: ReaderPageSize,
  container: ReaderContainerSize,
): number {
  if (state.fit === "width") {
    return computeFitWidthScale(page, container, state.rotation);
  }
  if (state.fit === "page") {
    return computeFitPageScale(page, container, state.rotation);
  }
  return clampScale(state.scale);
}

export function initialReaderViewport(page = 1): ReaderViewportState {
  return {
    scale: READER_DEFAULT_SCALE,
    fit: "width",
    rotation: 0,
    page: clampPage(page, Number.MAX_SAFE_INTEGER),
  };
}
