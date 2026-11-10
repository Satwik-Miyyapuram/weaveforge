/**
 * The ink tuning constants (Rust `ink::{width, zoom, smooth, segment, decode, figure}`),
 * read by core through `rust()` at call time.
 */
import { inkConstants as rawInkConstants } from "../pkg/wf_wasm.js";

/** The constants object `inkConstants()` returns; field names are camelCase. */
export interface InkConstants {
  inkWidthUnitsPerMm: number;
  inkPenWidths: [number, number, number, number];
  inkPenWidth: number;
  inkHighlighterWidth: number;
  inkHighlighterWidths: [number, number, number, number];
  inkHighlighterMinWidth: number;
  inkMinWidth: number;
  inkMaxWidth: number;
  inkVelocityFullTaper: number;
  inkVelocityTaper: number;
  inkPressureMinFactor: number;
  inkPressureMaxFactor: number;
  inkZoomMin: number;
  inkZoomMax: number;
  inkZoomStep: number;
  inkSmoothSpacing: number;
  inkSmoothPasses: number;
  inkGroupWindowMs: number;
  inkLineBandRatio: number;
  inkEngineMaxConfidence: number;
  figureAlt: string;
  figureHandles: [string, string, string, string, string, string, string, string];
}

/** The ink tuning constants, one call. */
export function inkConstants(): InkConstants {
  return rawInkConstants() as InkConstants;
}
