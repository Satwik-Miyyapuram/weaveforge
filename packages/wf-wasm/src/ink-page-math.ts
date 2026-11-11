/**
 * Ink page helpers: the fit, the selection's text and the figure hit tests
 * (Rust `ink::page_math`). Wasm returns `undefined` for "none"; these wrappers
 * return `null`, the shape the host has always used.
 */
import {
  doubleClickFigure as rawDoubleClickFigure,
  figureUnder as rawFigureUnder,
} from "../pkg/wf_wasm.js";
import type {
  HitBox as InkHitBox,
  Point as InkHitPoint,
} from "./bindings.js";

export {
  fitScale,
  selectedText,
} from "../pkg/wf_wasm.js";

export type { HitBox as InkHitBox, Point as InkHitPoint, TextLine as InkTextLine } from "./bindings.js";

/** The topmost figure whose box holds `at`, edges included, ignoring `skip`. */
export function figureUnder(
  figures: readonly (InkHitBox | undefined)[],
  at: InkHitPoint,
  skip: number | null = null,
): number | null {
  return rawFigureUnder(figures, at, skip ?? undefined) ?? null;
}

/** The figure every press of a double-click lands in, or `null`. */
export function doubleClickFigure(
  figures: readonly (InkHitBox | undefined)[],
  points: readonly InkHitPoint[],
  skip: number | null = null,
): number | null {
  return rawDoubleClickFigure(figures, points, skip ?? undefined) ?? null;
}
