/**
 * The ink trail's diameter (Rust `ink::trail`). The presenter and colour stay in TS.
 */
import { trailDiameterPx as rawTrailDiameterPx } from "../pkg/wf_wasm.js";

/** The trail's diameter in CSS px for a nib width in 0.1 mm on a page `pageWidthPx` wide. */
export function trailDiameterPx(width: number, pageWidthPx: number): number {
  return rawTrailDiameterPx(width, pageWidthPx);
}
