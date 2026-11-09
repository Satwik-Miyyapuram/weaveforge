/**
 * Lasso and erase hit tests for the ink worker (Rust `ink::hit_test`),
 * re-exported from index.ts.
 */
import {
  distanceToSegmentSquared as rawDistanceToSegmentSquared,
  inkPointInPolygon as rawInkPointInPolygon,
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
