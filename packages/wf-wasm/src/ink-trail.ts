/**
 * The ink trail's diameter (Rust `ink::trail`). The presenter and colour stay in TS.
 */
import {
  inkTrailAlpha as rawInkTrailAlpha,
  trailDiameterPx as rawTrailDiameterPx,
} from "../pkg/wf_wasm.js";

/** The trail's diameter in CSS px for a nib width in 0.1 mm on a page `pageWidthPx` wide. */
export function trailDiameterPx(width: number, pageWidthPx: number): number {
  return rawTrailDiameterPx(width, pageWidthPx);
}

/** The trail's opacity for a tool: translucent for a highlighter (Rust `trail_alpha`). */
export function inkTrailAlpha(tool: string): number {
  return rawInkTrailAlpha(tool);
}
