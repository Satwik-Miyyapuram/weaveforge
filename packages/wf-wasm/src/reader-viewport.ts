/**
 * Reader viewport math, PDF page projection and annotation sort keys (Rust
 * `reader::viewport`), re-exported from index.ts. Each function keeps the
 * signature and defaults of packages/core/src/reader/reader-viewport.ts,
 * page-projection.ts and sort-index.ts. Object shapes come from ./bindings.ts.
 */
import {
  clampScale as rawClampScale,
  computeFitWidthScale as rawComputeFitWidthScale,
  computeFitPageScale as rawComputeFitPageScale,
  visualPageSize as rawVisualPageSize,
  clampZoomFactor as rawClampZoomFactor,
  zoomIn as rawZoomIn,
  zoomOut as rawZoomOut,
  nextRotation as rawNextRotation,
  clampPage as rawClampPage,
  resolveViewportScale as rawResolveViewportScale,
  initialReaderViewport as rawInitialReaderViewport,
  normalisePageRotation as rawNormalisePageRotation,
  projectedPageSize as rawProjectedPageSize,
  pdfPointToScreen as rawPdfPointToScreen,
  screenPointToPdf as rawScreenPointToPdf,
  pdfRectToScreenBox as rawPdfRectToScreenBox,
  buildAnnotationSortIndex as rawBuildAnnotationSortIndex,
} from "../pkg/wf_wasm.js";
import type {
  ReaderContainerSize,
  ReaderFitMode,
  ReaderPageProjection,
  ReaderPageSize,
  ReaderViewportState,
} from "./bindings.js";

/** Default zoom when the container size is unknown is 1; clamps to the zoom range. */
export function clampScale(scale: number): number {
  return rawClampScale(scale);
}

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

/** The page size with the axes swapped at 90 and 270. */
export function visualPageSize(page: ReaderPageSize, rotation: 0 | 90 | 180 | 270): ReaderPageSize {
  return rawVisualPageSize(page, rotation) as ReaderPageSize;
}

/** A gesture's zoom factor, kept so `baseScale * factor` stays within the scale limits. */
export function clampZoomFactor(factor: number, baseScale: number): number {
  return rawClampZoomFactor(factor, baseScale);
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

/** Clamp a 1-based page number into [1, numPages]. */
export function clampPage(page: number, numPages: number): number {
  return rawClampPage(page, numPages);
}

/** The effective render scale for the current fit mode; `custom` returns the clamped stored scale. */
export function resolveViewportScale(
  state: Pick<ReaderViewportState, "scale" | "fit" | "rotation">,
  page: ReaderPageSize,
  container: ReaderContainerSize,
): number {
  return rawResolveViewportScale(state, page, container);
}

/** The starting viewport: fit-width, rotation 0, scale 1, on the clamped page. */
export function initialReaderViewport(page = 1): { scale: number; fit: ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number } {
  return rawInitialReaderViewport(page) as { scale: number; fit: ReaderFitMode; rotation: 0 | 90 | 180 | 270; page: number };
}

/** Folds any rotation onto 0, 90, 180 or 270. */
export function normalisePageRotation(rotation: number): 0 | 90 | 180 | 270 {
  return rawNormalisePageRotation(rotation) as 0 | 90 | 180 | 270;
}

/** Rendered size of the page at this rotation and scale, in CSS pixels. */
export function projectedPageSize(p: ReaderPageProjection): ReaderPageSize {
  return rawProjectedPageSize(p) as ReaderPageSize;
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

/** Zotero's annotationSortIndex: zero-padded `page|offset|top`, so lexical sort is reading order. */
export function buildAnnotationSortIndex(pageIndex: number, charOffset: number, topPdfUnits: number): string {
  return rawBuildAnnotationSortIndex(pageIndex, charOffset, topPdfUnits);
}
