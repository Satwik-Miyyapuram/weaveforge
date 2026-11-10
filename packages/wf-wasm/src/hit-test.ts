/**
 * Lasso and erase hit tests for the ink worker (Rust `ink::hit_test`),
 * re-exported from index.ts.
 */
import {
  distanceToSegmentSquared as rawDistanceToSegmentSquared,
  inkLassoKeeps as rawInkLassoKeeps,
  inkPointInPolygon as rawInkPointInPolygon,
  inkPolygonBounds as rawInkPolygonBounds,
  inkStrokeNearSegment as rawInkStrokeNearSegment,
} from "../pkg/wf_wasm.js";

/** Whether `(px, py)` is inside the flat `x,y` polygon, by the even-odd rule. */
export function inkPointInPolygon(
  px: number,
  py: number,
  polygon: readonly number[],
): boolean {
  return rawInkPointInPolygon(px, py, polygon);
}

/** The squared distance from `(px, py)` to the segment `a`–`b`. */
export function distanceToSegmentSquared(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return rawDistanceToSegmentSquared(px, py, ax, ay, bx, by);
}

/** Whether a stroke (`xs`/`ys`) comes within `radius` of the segment `from`–`to`. */
export function inkStrokeNearSegment(
  xs: Float32Array,
  ys: Float32Array,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  radius: number,
): boolean {
  return rawInkStrokeNearSegment(xs, ys, fx, fy, tx, ty, radius);
}

/** Whether a lasso polygon (flat `x,y` Float64Array) keeps a stroke, half its points inside. */
export function inkLassoKeeps(xs: Float32Array, ys: Float32Array, polygon: Float64Array): boolean {
  return rawInkLassoKeeps(xs, ys, polygon);
}

/** The `[minX, minY, maxX, maxY]` box of a flat `x,y` polygon (Rust `polygon_bounds`). */
export function inkPolygonBounds(polygon: Float64Array): Float64Array {
  return Float64Array.from(rawInkPolygonBounds(polygon));
}
