/**
 * Ink render instance wrappers (WebGL stroke renderer maths). Point arrays
 * cross as `Float64Array`s. Rust: `wf_core::ink::render_instances`.
 */
import {
  inkBackingRatio as rawInkBackingRatio,
  inkStrokeInstanceCount as rawInkStrokeInstanceCount,
  packInkStrokeInstances as rawPackInkStrokeInstances,
  usesInkHighlighterPass as rawUsesInkHighlighterPass,
} from "../pkg/wf_wasm.js";

/** How many instances a stroke of `points` samples packs to (Rust `stroke_instance_count`). */
export function inkStrokeInstanceCount(points: number): number {
  return rawInkStrokeInstanceCount(points);
}

/** The instance floats for a stroke from span `from` on (Rust `pack_stroke_instances`). */
export function packInkStrokeInstances(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  width: number,
  from = 0,
): Float64Array {
  return rawPackInkStrokeInstances(Float64Array.from(xs), Float64Array.from(ys), width, from);
}

/** The pixel ratio a canvas of the given CSS size is given (Rust `backing_ratio`). */
export function inkBackingRatio(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): number {
  return rawInkBackingRatio(cssWidth, cssHeight, devicePixelRatio);
}

/** Whether a tool is drawn translucent through the stencil (Rust `uses_highlighter_pass`). */
export function usesInkHighlighterPass(tool: string): boolean {
  return rawUsesInkHighlighterPass(tool);
}
