/**
 * Timeline layout lanes (Rust `relations::graph_timeline`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/graph-timeline.ts.
 */
import { timelineLaneOffset, timelineMidYear } from "../pkg/wf_wasm.js";

export {
  timelineLaneOffset,
  timelineMidYear,
  yearSpacing,
} from "../pkg/wf_wasm.js";

/**
 * The timeline layout: each node's x is fixed to its publication year, centred on the
 * mean year of the collection. Nodes without a year get `null` and are left to the forces.
 * Returns `null` when the layout is not `"timeline"` or no node has a year.
 */
export function timelineLaneX(
  layout: string,
  nodes: readonly { year?: number | null }[],
): ((node: { year?: number | null }) => number | null) | null {
  const mid = timelineMidYear(layout, nodes.map((n) => n.year ?? null));
  if (mid === null) return null;
  return (node) => timelineLaneOffset(mid, node.year ?? undefined);
}
