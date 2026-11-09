/**
 * Graph simulation restart key (Rust `relations::graph_topology`),
 * re-exported from index.ts.
 */
import { graphTopologyKey as rawGraphTopologyKey } from "../pkg/wf_wasm.js";

/** What the simulation is laid out over; a change to the returned key restarts it. */
export function graphTopologyKey(
  shown: { nodes: readonly { id: string }[]; links: readonly { id: string }[] },
  localSeed: string | null,
  localDepth: number,
): string {
  return rawGraphTopologyKey(shown, localSeed ?? undefined, localDepth);
}
