/**
 * Lasso and erase hit tests for the ink worker (Rust `ink::hit_test`),
 * re-exported from index.ts.
 */
import {
  inkPolygonBounds as rawInkPolygonBounds,
} from "../pkg/wf_wasm.js";

export {
  inkPointInPolygon,
} from "../pkg/wf_wasm.js";

export {
  distanceToSegmentSquared,
  inkLassoKeeps,
  inkStrokeNearSegment,
} from "../pkg/wf_wasm.js";

/** The `[minX, minY, maxX, maxY]` box of a flat `x,y` polygon (Rust `polygon_bounds`). */
export function inkPolygonBounds(polygon: Float64Array): Float64Array {
  return Float64Array.from(rawInkPolygonBounds(polygon));
}
