/**
 * Ink geometry wrappers (step 5-2b), re-exported from index.ts. Point and
 * pressure arrays cross as `Float64Array`s; the stroke types come from
 * ./bindings.ts.
 */
import {
  inkTangentAt as rawInkTangentAt,
  inkCurveAt as rawInkCurveAt,
  resampleInkStroke as rawResampleInkStroke,
  binomialSmooth as rawBinomialSmooth,
  smoothInkStroke as rawSmoothInkStroke,
  clampInkNoteWidth as rawClampInkNoteWidth,
  inkPressureFactor as rawInkPressureFactor,
  inkVelocityFactor as rawInkVelocityFactor,
  nibWidth as rawNibWidth,
  inkVelocityBetween as rawInkVelocityBetween,
  strokeBaseWidth as rawStrokeBaseWidth,
  clampInkZoom as rawClampInkZoom,
  inkZoomIn as rawInkZoomIn,
  inkZoomOut as rawInkZoomOut,
  packInkStroke as rawPackInkStroke,
} from "../pkg/wf_wasm.js";
import type { InkStrokePackerOptions, PackedInkStroke } from "./bindings.js";

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

/** `values` smoothed with the [1, 2, 1] kernel, ends kept (Rust `binomial_smooth`). */
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

/** The width factor for a 0-255 pressure (Rust `ink_pressure_factor`). */
export function inkPressureFactor(pressure: number | undefined): number {
  return rawInkPressureFactor(pressure);
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

/** Pen speed between two timed samples (Rust `ink_velocity_between`). */
export function inkVelocityBetween(
  x0: number,
  y0: number,
  t0: number,
  x1: number,
  y1: number,
  t1: number,
): number {
  return rawInkVelocityBetween(x0, y0, t0, x1, y1, t1);
}

/** The base width a stroke is stored with, from its pressures (Rust `stroke_base_width`). */
export function strokeBaseWidth(samples: readonly number[], base: number): number {
  return rawStrokeBaseWidth(Float64Array.from(samples), base);
}

/** `zoom` within the ink zoom limits (Rust `clamp_ink_zoom`). */
export function clampInkZoom(zoom: number): number {
  return rawClampInkZoom(zoom);
}

/** One zoom step in (Rust `ink_zoom_in`). */
export function inkZoomIn(zoom: number): number {
  return rawInkZoomIn(zoom);
}

/** One zoom step out (Rust `ink_zoom_out`). */
export function inkZoomOut(zoom: number): number {
  return rawInkZoomOut(zoom);
}

/** A whole stroke packed as the live packer would (Rust `pack_ink_stroke`). */
export function packInkStroke(
  points: readonly number[],
  pressures: readonly number[] = [],
  options: InkStrokePackerOptions = {},
): PackedInkStroke {
  return rawPackInkStroke(Float64Array.from(points), Float64Array.from(pressures), options) as PackedInkStroke;
}
