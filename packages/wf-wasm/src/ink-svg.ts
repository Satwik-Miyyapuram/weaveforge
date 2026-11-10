/**
 * Ink page SVG export wrappers, re-exported from index.ts. The types come from
 * bindings.ts; the functions are the Rust `ink_svg` exports.
 */
import {
  inkPageSvg as rawInkPageSvg,
  strokePath as rawStrokePath,
} from "../pkg/wf_wasm.js";
import type { InkSvgOptions, InkSvgPage } from "./bindings.js";

export type { InkSvgFigure, InkSvgOptions, InkSvgPage, InkSvgStroke } from "./bindings.js";

/**
 * One stroke's centreline as an SVG path, or `null` for fewer than two numbers
 * (Rust `stroke_path`). Takes the flat `[x0, y0, x1, y1, ...]` points.
 */
export function strokePath(points: readonly number[]): string | null {
  return rawStrokePath(Float64Array.from(points)) ?? null;
}

/** The page as an SVG document (Rust `ink_page_svg`). */
export function inkPageSvg(page: InkSvgPage, options: InkSvgOptions = {}): string {
  return rawInkPageSvg(page, options);
}
