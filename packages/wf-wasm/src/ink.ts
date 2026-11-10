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
  resampleInkStroke as rawResampleInkStroke,
  binomialSmooth as rawBinomialSmooth,
  smoothInkStroke as rawSmoothInkStroke,
  clampInkNoteWidth as rawClampInkNoteWidth,
  inkVelocityFactor as rawInkVelocityFactor,
  nibWidth as rawNibWidth,
  strokeBaseWidth as rawStrokeBaseWidth,
  packInkStroke as rawPackInkStroke,
  createInkStrokePacker as rawCreateInkStrokePacker,
  snapInkShape as rawSnapInkShape,
} from "../pkg/wf_wasm.js";
import type {
  InkShape,
  InkStrokePackerOptions,
  PackedInkStroke,
} from "./bindings.js";

export {
  clampInkZoom,
  inkPressureFactor,
  inkStrokeBandOf,
  inkVelocityBetween,
  inkZoomIn,
  inkZoomOut,
  pressureByte,
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

/** The stroke resampled to an even spacing (Rust `resample_ink_stroke`). */
export function resampleInkStroke(
  points: readonly number[],
  pressures: readonly number[],
  spacing?: number,
): PackedInkStroke {
  return rawResampleInkStroke(Float64Array.from(points), Float64Array.from(pressures), spacing) as PackedInkStroke;
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

/** A stored ink width within the limits, or `fallback` (Rust `clamp_ink_note_width`). */
export function clampInkNoteWidth(width: number, fallback?: number): number {
  return rawClampInkNoteWidth(width, fallback);
}

/** The width factor for a pen speed (Rust `ink_velocity_factor`). */
export function inkVelocityFactor(velocity: number, fullTaper?: number): number {
  return rawInkVelocityFactor(velocity, fullTaper);
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

/** The base width a stroke is stored with, from its pressures (Rust `stroke_base_width`). */
export function strokeBaseWidth(samples: readonly number[], base: number): number {
  return rawStrokeBaseWidth(Float64Array.from(samples), base);
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

/** Fit a line, rect, ellipse or arrow to a mark, or null when it abstains (Rust `snap_ink_shape`). */
export function snapInkShape(points: readonly number[]): { points: number[]; shape: Exclude<InkShape, "none"> } | null {
  return rawSnapInkShape(Float64Array.from(points)) as { points: number[]; shape: Exclude<InkShape, "none"> } | null;
}

/** The words a recogniser vocabulary allows, in order. */
export function inkVocabularyWordList(vocabulary: readonly string[]): string[] {
  return rawInkVocabularyWordList([...vocabulary]) as string[];
}
