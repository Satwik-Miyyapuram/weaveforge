/**
 * Ink render instance wrappers (WebGL stroke renderer maths). Point arrays
 * cross as `Float64Array`s. Rust: `wf_core::ink::render_instances`.
 */
import {
  packInkStrokeInstances as rawPackInkStrokeInstances,
} from "../pkg/wf_wasm.js";

export {
  inkBackingRatio,
  inkStrokeInstanceCount,
  usesInkHighlighterPass,
} from "../pkg/wf_wasm.js";

/** The instance floats for a stroke from span `from` on (Rust `pack_stroke_instances`). */
export function packInkStrokeInstances(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  width: number,
  from = 0,
): Float64Array {
  return rawPackInkStrokeInstances(Float64Array.from(xs), Float64Array.from(ys), width, from);
}

