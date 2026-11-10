/**
 * Lasso and erase hit tests for the ink worker (Rust `ink::hit_test`),
 * re-exported from index.ts.
 */
import {
  inkPointInPolygon as rawInkPointInPolygon,
  inkPolygonBounds as rawInkPolygonBounds,
} from "../pkg/wf_wasm.js";

export {
  distanceToSegmentSquared,
  inkLassoKeeps,
  inkStrokeNearSegment,
} from "../pkg/wf_wasm.js";

/** Whether `(px, py)` is inside the flat `x,y` polygon, by the even-odd rule. */
export function inkPointInPolygon(
  px: number,
  py: number,
  polygon: readonly number[],
): boolean {
  return rawInkPointInPolygon(px, py, polygon);
}

/** The `[minX, minY, maxX, maxY]` box of a flat `x,y` polygon (Rust `polygon_bounds`). */
export function inkPolygonBounds(polygon: Float64Array): Float64Array {
  return Float64Array.from(rawInkPolygonBounds(polygon));
}
