/**
 * Ink page SVG export wrappers, re-exported from index.ts. The types come from
 * bindings.ts; the functions are the Rust `ink_svg` exports.
 */
import {
  inkPageSvg as rawInkPageSvg,
} from "../pkg/wf_wasm.js";
import type { InkSvgOptions, InkSvgPage } from "./bindings.js";

export type { InkSvgFigure, InkSvgOptions, InkSvgPage, InkSvgStroke } from "./bindings.js";

export {
  strokePath,
} from "../pkg/wf_wasm.js";

/** The page as an SVG document (Rust `ink_page_svg`). */
export function inkPageSvg(page: InkSvgPage, options: InkSvgOptions = {}): string {
  return rawInkPageSvg(page, options);
}
