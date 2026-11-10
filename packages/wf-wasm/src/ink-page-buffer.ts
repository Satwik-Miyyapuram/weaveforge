/**
 * The ink page buffer's pure helpers (Rust `ink::page_buffer`): bounding boxes,
 * the compaction remap, the background-index clamp. Re-exported from index.ts.
 * Bounds are flat `[minX, minY, maxX, maxY]` Float64Arrays.
 */
import {
  inkBoundsContain as rawInkBoundsContain,
  inkBoundsIntersect as rawInkBoundsIntersect,
  inkBoundsOf as rawInkBoundsOf,
  inkBoundsUnion as rawInkBoundsUnion,
  inkClampBackgroundIndex as rawInkClampBackgroundIndex,
  inkKeptIndices as rawInkKeptIndices,
  inkPageBounds as rawInkPageBounds,
  inkPickCandidates as rawInkPickCandidates,
} from "../pkg/wf_wasm.js";

/** The bounding box of parallel `xs`/`ys`; empty input gives `[0, 0, 0, 0]`. */
export function inkBoundsOf(xs: Float32Array, ys: Float32Array): Float64Array {
  return rawInkBoundsOf(xs, ys);
}

/** Whether two boxes overlap, touching included; `slack` grows both. */
export function inkBoundsIntersect(a: Float64Array, b: Float64Array, slack: number): boolean {
  return rawInkBoundsIntersect(a, b, slack);
}

/** The smallest box covering `a` and `b`. */
export function inkBoundsUnion(a: Float64Array, b: Float64Array): Float64Array {
  return rawInkBoundsUnion(a, b);
}

/** Whether a point lies in a box, `slack` growing it. */
export function inkBoundsContain(bounds: Float64Array, x: number, y: number, slack: number): boolean {
  return rawInkBoundsContain(bounds, x, y, slack);
}

/** The page's box over its strokes: four numbers per stroke in `boxes`, `live[i]` 0 for a dead one. */
export function inkPageBounds(boxes: Float64Array, live: Uint8Array): Float64Array {
  return rawInkPageBounds(boxes, live);
}

/**
 * The R-tree candidates that are alive and meet `query` grown by `slack`, in input
 * order. `indices[i]` is a stroke index with `alive[i]` (1 live) and its box at
 * `bounds[4i..4i+4]`; `query` is `[minX, minY, maxX, maxY]`.
 */
export function inkPickCandidates(
  indices: Uint32Array,
  alive: Uint8Array,
  bounds: Float64Array,
  query: Float64Array,
  slack: number,
): Uint32Array {
  return rawInkPickCandidates(indices, alive, bounds, query, slack);
}

/** The old index of each live stroke, in order. */
export function inkKeptIndices(alive: Uint8Array): Uint32Array {
  return rawInkKeptIndices(alive);
}

/** The background attachment index clamped to a byte; non-finite input is 0. */
export function inkClampBackgroundIndex(index: number): number {
  return rawInkClampBackgroundIndex(index);
}
