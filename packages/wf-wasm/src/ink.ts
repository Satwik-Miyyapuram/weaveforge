/**
 * Ink geometry wrappers (step 5-2b), re-exported from index.ts. Point and
 * pressure arrays cross as `Float64Array`s; the stroke types come from
 * ./bindings.ts.
 */
import {
  inkTangentAt as rawInkTangentAt,
  inkStrokeBandOf as rawInkStrokeBandOf,
  inkVocabularyWordList as rawInkVocabularyWordList,
  inkCurveAt as rawInkCurveAt,
  binomialSmooth as rawBinomialSmooth,
  smoothInkStroke as rawSmoothInkStroke,
  nibWidth as rawNibWidth,
  packInkStroke as rawPackInkStroke,
  createInkStrokePacker as rawCreateInkStrokePacker,
} from "../pkg/wf_wasm.js";
import type {
  InkStrokePackerOptions,
  PackedInkStroke,
} from "./bindings.js";

export {
  clampInkNoteWidth,
  clampInkZoom,
  inkPressureFactor,
  inkStrokeBandOf,
  inkVelocityBetween,
  inkVelocityFactor,
  inkZoomIn,
  inkZoomOut,
  pressureByte,
  resampleInkStroke,
  snapInkShape,
  strokeBaseWidth,
} from "../pkg/wf_wasm.js";

/** The stroke's tangent at sample `i` for the span on `side` (Rust `ink_tangent_at`). */
export function inkTangentAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  side: "in" | "out" = "out",
): { x: number; y: number } {
  const [x, y] = rawInkTangentAt(Float64Array.from(xs), Float64Array.from(ys), i, side);
  return { x: x!, y: y! };
}

/** A point on the span from sample `i` to `i + 1` at `u` in [0, 1] (Rust `ink_curve_at`). */
export function inkCurveAt(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  i: number,
  u: number,
): { x: number; y: number } {
  const [x, y] = rawInkCurveAt(Float64Array.from(xs), Float64Array.from(ys), i, u);
  return { x: x!, y: y! };
}

/** `values` smoothed with the five-tap [1, 4, 6, 4, 1] / 16 kernel, ends kept (Rust `binomial_smooth`). */
export function binomialSmooth(values: readonly number[], stride: number, passes = 2): number[] {
  return Array.from(rawBinomialSmooth(Float64Array.from(values), stride, passes));
}

/** A finished stroke resampled and smoothed (Rust `smooth_ink_stroke`). */
export function smoothInkStroke(
  points: readonly number[],
  pressures: readonly number[],
  options: { spacing?: number; passes?: number } = {},
): PackedInkStroke {
  return rawSmoothInkStroke(Float64Array.from(points), Float64Array.from(pressures), options) as PackedInkStroke;
}

/** The nib width for a base width, pressure and speed (Rust `nib_width`). */
export function nibWidth(
  base: number,
  pressure?: number,
  velocity = 0,
  options: { fullTaper?: number } = {},
): number {
  return rawNibWidth(base, pressure, velocity, options.fullTaper);
}

/**
 * A live packer for one stroke (Rust `InkStrokePacker`): `push` each pen
 * sample, read `points()` / `pressures()` for the stroke so far.
 */
export function createInkStrokePacker(
  options: InkStrokePackerOptions = {},
): ReturnType<typeof rawCreateInkStrokePacker> {
  return rawCreateInkStrokePacker(options);
}

/** A whole stroke packed as the live packer would (Rust `pack_ink_stroke`). */
export function packInkStroke(
  points: readonly number[],
  pressures: readonly number[] = [],
  options: InkStrokePackerOptions = {},
): PackedInkStroke {
  return rawPackInkStroke(Float64Array.from(points), Float64Array.from(pressures), options) as PackedInkStroke;
}

/** The words a recogniser vocabulary allows, one per whitespace-separated token. */
export function inkVocabularyWords(vocabulary: readonly string[]): Set<string> {
  return new Set(rawInkVocabularyWordList([...vocabulary]) as string[]);
}

/** The y band [min, max] of a stroke, or null for a stroke with no points. */
export function inkStrokeBand(stroke: { points: ArrayLike<number> }): [number, number] | null {
  const band = rawInkStrokeBandOf(Float64Array.from(stroke.points));
  return band ? [band[0] as number, band[1] as number] : null;
}

/** The words a recogniser vocabulary allows, in order. */
export function inkVocabularyWordList(vocabulary: readonly string[]): string[] {
  return rawInkVocabularyWordList([...vocabulary]) as string[];
}
