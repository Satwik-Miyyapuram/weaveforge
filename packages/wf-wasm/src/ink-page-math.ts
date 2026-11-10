/**
 * Ink page helpers: the fit, the selection's text and the figure hit tests
 * (Rust `ink::page_math`). Wasm returns `undefined` for "none"; these wrappers
 * return `null`, the shape the host has always used.
 */
import {
  doubleClickFigure as rawDoubleClickFigure,
  figureUnder as rawFigureUnder,
  fitScale as rawFitScale,
  selectedText as rawSelectedText,
} from "../pkg/wf_wasm.js";
import type { HitBox as InkHitBox, Point as InkHitPoint, TextLine as InkTextLine } from "./bindings.js";

export type { HitBox as InkHitBox, Point as InkHitPoint, TextLine as InkTextLine } from "./bindings.js";

/** The fit: how many CSS pixels one 0.1 mm unit is worth. */
export function fitScale(containerWidth: number, pageWidth: number): number {
  return rawFitScale(containerWidth, pageWidth);
}

/** The lines the chosen strokes belong to, as text, one per line. */
export function selectedText(
  lines: readonly InkTextLine[],
  indices: readonly number[],
): string {
  return rawSelectedText(lines, indices);
}

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
