/**
 * Monte Carlo personalized PageRank (Rust `personalized_pagerank`), re-exported from index.ts.
 * Each function keeps the signature of the old TS module (removed; its types now live in packages/core/src/shared/core-contract.ts).
 */
import {
  personalizedPageRank as rawPersonalizedPageRank,
  relatedByPpr as rawRelatedByPpr,
} from "../pkg/wf_wasm.js";
import type { PprOptions, RelatedNode } from "./bindings.js";

/** Map edges become entries in insertion order, which the Rust side keeps. */
function toWasmGraph(graph: { nodes: string[]; edges: Map<string, string[]> }) {
  return {
    nodes: graph.nodes,
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours })),
  };
}

function toWasmOptions(options: { numWalks?: number; maxSteps?: number; damping?: number }): PprOptions {
  return { numWalks: options.numWalks, maxSteps: options.maxSteps, damping: options.damping };
}

export function personalizedPageRank(
  graph: { nodes: string[]; edges: Map<string, string[]> },
  seed: string,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): Map<string, number> {
  const scores = rawPersonalizedPageRank(
    toWasmGraph(graph),
    seed,
    toWasmOptions(options),
    options.rng ?? Math.random,
  ) as { node: string; score: number }[];
  return new Map(scores.map((s) => [s.node, s.score]));
}

/** Top-k neighbours by PPR, excluding the seed itself. */
export function relatedByPpr(
  graph: { nodes: string[]; edges: Map<string, string[]> },
  seed: string,
  limit = 10,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): RelatedNode[] {
  // Rust returns every neighbour; slicing here keeps JS `slice` semantics for any limit.
  const related = rawRelatedByPpr(
    toWasmGraph(graph),
    seed,
    0xffffffff,
    toWasmOptions(options),
    options.rng ?? Math.random,
  ) as RelatedNode[];
  return related.slice(0, limit);
}
