/**
 * Reader viewport math, PDF page projection and annotation sort keys (Rust
 * `reader::viewport`), re-exported from index.ts. Each function keeps the
 * signature and defaults of the removed packages/core/src/reader/reader-viewport.ts,
 * page-projection.ts and sort-index.ts. Object shapes come from ./bindings.ts.
 */
import {
  pdfPointToScreen as rawPdfPointToScreen,
  screenPointToPdf as rawScreenPointToPdf,
  pdfRectToScreenBox as rawPdfRectToScreenBox,
} from "../pkg/wf_wasm.js";
import type {
  ReaderPageProjection,
} from "./bindings.js";

export {
  initialReaderViewport,
  resolveViewportScale,
} from "../pkg/wf_wasm.js";

export {
  buildAnnotationSortIndex,
  clampPage,
  clampScale,
  clampZoomFactor,
  computeFitPageScale,
  computeFitWidthScale,
  nextRotation,
  normalisePageRotation,
  projectedPageSize,
  visualPageSize,
  zoomIn,
  zoomOut,
} from "../pkg/wf_wasm.js";

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

