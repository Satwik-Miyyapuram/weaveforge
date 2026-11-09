/**
 * The ink draw area and the cut where the pen leaves it (Rust
 * `ink::clip_to_area`), re-exported from index.ts.
 */
import {
  pointInArea as rawPointInArea,
  clipSegmentToArea as rawClipSegmentToArea,
} from "../pkg/wf_wasm.js";
import type { ClippedSegment, DrawArea, Point } from "./bindings.js";

export type { ClippedSegment, DrawArea, Point } from "./bindings.js";

/** Whether a point is inside the area, edges included. */
export function pointInArea(area: DrawArea, x: number, y: number): boolean {
  return rawPointInArea(area, x, y);
}

/** The part of a segment inside the area, or `null` for none of it. */
export function clipSegmentToArea(area: DrawArea, from: Point, to: Point): ClippedSegment | null {
  return rawClipSegmentToArea(area, from, to) as ClippedSegment | null;
}
