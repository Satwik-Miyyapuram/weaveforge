/**
 * Graph node and label sizes at a zoom (Rust `relations::graph_sizing`), re-exported from index.ts.
 * Sizes are in graph units; every stroke is a fraction of the drawn size, so an outline never
 * outgrows its node. Types come from ./bindings.js.
 */
import { labelSize as rawLabelSize } from "../pkg/wf_wasm.js";
import type { LabelSize, NodeSize } from "./bindings.js";

export { nodeSize } from "../pkg/wf_wasm.js";

export type { LabelSize, NodeSize };

/** How big a label draws at `zoom`. `kind === "tag"` picks the tag label's base size. */
export function labelSize(kind: string, zoom: number, bounded = true): LabelSize {
  return rawLabelSize(kind === "tag", zoom, bounded) as LabelSize;
}
