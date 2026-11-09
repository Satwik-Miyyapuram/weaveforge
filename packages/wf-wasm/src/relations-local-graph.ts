/**
 * Local graph subgraph (Rust `relations::local_graph`), re-exported from index.ts.
 */
import { localSubgraph as rawLocalSubgraph } from "../pkg/wf_wasm.js";

/**
 * The nodes within `depth` hops of `seedId`, the seed included, or null when there is no seed
 * or `depth` is below 1.
 */
export function localSubgraph(
  seedId: string | null,
  depth: number,
  neighbors: Map<string, Set<string>>,
): Set<string> | null {
  const pairs = [...neighbors].map(([id, ns]): [string, string[]] => [id, [...ns]]);
  const ids = rawLocalSubgraph(seedId, depth, pairs) as string[] | null;
  return ids ? new Set(ids) : null;
}
