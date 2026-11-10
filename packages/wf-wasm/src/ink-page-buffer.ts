export {
  inkBoundsContain,
  inkBoundsIntersect,
  inkBoundsOf,
  inkBoundsUnion,
  inkClampBackgroundIndex,
  inkKeptIndices,
  inkPageBounds,
  inkPickCandidates,
} from "../pkg/wf_wasm.js";
/**
 * The ink page buffer's pure helpers (Rust `ink::page_buffer`): bounding boxes,
 * the compaction remap, the background-index clamp. Re-exported from index.ts.
 * Bounds are flat `[minX, minY, maxX, maxY]` Float64Arrays.
 */

