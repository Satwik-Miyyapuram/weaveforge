/**
 * The ink draw area and the cut where the pen leaves it (Rust
 * `ink::clip_to_area`), re-exported from index.ts.
 */
import type {
  ClippedSegment,
  DrawArea,
  Point,
} from "./bindings.js";

export {
  clipSegmentToArea,
  pointInArea,
} from "../pkg/wf_wasm.js";

export type { ClippedSegment, DrawArea, Point } from "./bindings.js";

