/**
 * Local graph subgraph and the graph helpers the canvas applies to it (Rust
 * `relations::local_graph`), re-exported from index.ts.
 */
import {
  cloneLinks as rawCloneLinks,
  filterGraphByNodes as rawFilterGraphByNodes,
  linkNodeId as rawLinkNodeId,
  localSubgraph as rawLocalSubgraph,
} from "../pkg/wf_wasm.js";

/** The id a link endpoint names: the string itself, or the `id` of an endpoint object. */
export function linkNodeId(source: string | { id: string }): string {
  return rawLinkNodeId(source) as string;
}

/**
 * The nodes whose id is in `allowed` (all of them when `null`), and the links whose two
 * endpoints both remain. Works on copies: the inputs are not mutated.
 */
export function filterGraphByNodes<T extends { id: string }, L extends Record<"source" | "target", string | { id: string }>>(
  nodes: T[],
  links: L[],
  allowed: Set<string> | null,
): { nodes: T[]; links: L[] } {
  return rawFilterGraphByNodes(nodes, links, allowed ? [...allowed] : null) as {
    nodes: T[];
    links: L[];
  };
}

/** Copies of the links with string endpoints, every other field kept. */
export function cloneLinks<L extends Record<"source" | "target", string | { id: string }>>(
  links: L[],
): (L & Record<"source" | "target", string>)[] {
  return rawCloneLinks(links) as (L & Record<"source" | "target", string>)[];
}

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
