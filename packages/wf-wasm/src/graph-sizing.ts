/**
 * Graph node and label sizes at a zoom (Rust `relations::graph_sizing`), re-exported from index.ts.
 * Sizes are in graph units; every stroke is a fraction of the drawn size, so an outline never
 * outgrows its node. Types come from ./bindings.js.
 */
import { nodeSize as rawNodeSize, labelSize as rawLabelSize } from "../pkg/wf_wasm.js";
import type { LabelSize, NodeSize } from "./bindings.js";

export type { LabelSize, NodeSize };

/** How big a node draws at `zoom`. `bounded` (default true) caps the growth with the zoom. */
export function nodeSize(baseR: number, zoom: number, bounded = true): NodeSize {
  return rawNodeSize(baseR, zoom, bounded) as NodeSize;
}

/** How big a label draws at `zoom`. `kind === "tag"` picks the tag label's base size. */
export function labelSize(kind: string, zoom: number, bounded = true): LabelSize {
  return rawLabelSize(kind === "tag", zoom, bounded) as LabelSize;
}
