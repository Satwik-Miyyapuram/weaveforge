/**
 * Where a page background sits on the A4 sheet (Rust `ink::page_background`),
 * re-exported from index.ts.
 */
import { placeOnSheet as rawPlaceOnSheet } from "../pkg/wf_wasm.js";
import type { Placement } from "./bindings.js";

export type { Placement };

/** As large as fits the sheet without cropping, centred on the axis it does not fill. */
export function placeOnSheet(
  sourceWidth: number,
  sourceHeight: number,
  sheetWidth: number,
  sheetHeight: number,
): Placement {
  return rawPlaceOnSheet(sourceWidth, sourceHeight, sheetWidth, sheetHeight);
}
