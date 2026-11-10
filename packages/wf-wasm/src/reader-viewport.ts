/**
 * Reader viewport math, PDF page projection and annotation sort keys (Rust
 * `reader::viewport`), re-exported from index.ts. Each function keeps the
 * signature and defaults of the removed packages/core/src/reader/reader-viewport.ts,
 * page-projection.ts and sort-index.ts. Object shapes come from ./bindings.ts.
 */
import {
  computeFitWidthScale as rawComputeFitWidthScale,
  computeFitPageScale as rawComputeFitPageScale,
  zoomIn as rawZoomIn,
  zoomOut as rawZoomOut,
  nextRotation as rawNextRotation,
  initialReaderViewport as rawInitialReaderViewport,
  pdfPointToScreen as rawPdfPointToScreen,
  screenPointToPdf as rawScreenPointToPdf,
  pdfRectToScreenBox as rawPdfRectToScreenBox,
} from "../pkg/wf_wasm.js";
import type {
  ReaderContainerSize,
  ReaderFitMode,
  ReaderPageProjection,
  ReaderPageSize,
} from "./bindings.js";

export {
  resolveViewportScale,
} from "../pkg/wf_wasm.js";

export {
  buildAnnotationSortIndex,
  clampPage,
  clampScale,
  clampZoomFactor,
  normalisePageRotation,
  projectedPageSize,
  visualPageSize,
} from "../pkg/wf_wasm.js";

/** Scale so the page width fills the container, with a `gutterPx` gutter. */
export function computeFitWidthScale(
  page: ReaderPageSize,
  container: ReaderContainerSize,
  rotation: 0 | 90 | 180 | 270 = 0,
  gutterPx = 24,
): number {
  return rawComputeFitWidthScale(page, container, rotation, gutterPx);
}

/** Scale so the whole page fits inside the container (letterbox). */
export function computeFitPageScale(
  page: ReaderPageSize,
  container: ReaderContainerSize,
  rotation: 0 | 90 | 180 | 270 = 0,
  gutterPx = 24,
): number {
  return rawComputeFitPageScale(page, container, rotation, gutterPx);
}

/** Zoom in by `step`, clamped to the zoom range. */
export function zoomIn(scale: number, step = 1.25): number {
  return rawZoomIn(scale, step);
}

/** Zoom out by `step`, clamped to the zoom range. */
export function zoomOut(scale: number, step = 1.25): number {
  return rawZoomOut(scale, step);
}

/** The rotation after turning by `delta` degrees, wrapped into [0, 360). */
export function nextRotation(current: 0 | 90 | 180 | 270, delta: 90 | -90 = 90): 0 | 90 | 180 | 270 {
  return rawNextRotation(current, delta) as 0 | 90 | 180 | 270;
}

/** The starting viewport: fit-width, rotation 0, scale 1, on the clamped page. */
export function initialReaderViewport(page = 1): { scale: number; fit: ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number } {
  return rawInitialReaderViewport(page) as { scale: number; fit: ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number };
}

/** PDF user-space point to CSS pixels within the rendered page box. */
export function pdfPointToScreen(x: number, y: number, p: ReaderPageProjection): { x: number; y: number } {
  return rawPdfPointToScreen(x, y, p) as { x: number; y: number };
}

/** CSS pixels within the rendered page box to a PDF user-space point. */
export function screenPointToPdf(sx: number, sy: number, p: ReaderPageProjection): { x: number; y: number } {
  return rawScreenPointToPdf(sx, sy, p) as { x: number; y: number };
}

/** A PDF-space rect `[x1,y1,x2,y2]` as a screen-space box, corners re-normalised. */
export function pdfRectToScreenBox(
  rect: readonly [number, number, number, number],
  p: ReaderPageProjection,
): { left: number; top: number; width: number; height: number } {
  return rawPdfRectToScreenBox(Float64Array.from(rect), p) as { left: number; top: number; width: number; height: number };
}

