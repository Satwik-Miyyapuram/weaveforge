/**
 * Related-document arm helpers (Rust `search::related`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/related.ts.
 */
import {
  explainArm as rawExplainArm,
  findRelated as rawFindRelated,
} from "../pkg/wf_wasm.js";
import type { RelatedArm, RelatedResult } from "./bindings.js";

/** Below this the seed has too little neighbourhood for a walk to say anything. */
export const MIN_SEED_DEGREE_FOR_PPR = 3;

/** Human-readable reason, so a thin result set is explained rather than puzzling. */
export function explainArm(arm: RelatedArm): string {
  return rawExplainArm(arm);
}

/** Same graph shape as the PPR wrappers: edges become `{ node, neighbours }` in insertion order. */
function toWasmGraph(graph: { nodes: string[]; edges: Map<string, string[]> }) {
  return {
    nodes: graph.nodes,
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours })),
  };
}

/**
 * Related documents for a seed: graph walk first, then the lexical arm, then the tag arm.
 * The first non-empty arm wins. `lexical` and `tagged` run only when the arms before them came
 * back empty, so they are called lazily from Rust.
 */
/**
 * A related result as Rust sends it: `score` is always a number, and `arms` and
 * `similarity` are left out rather than null (bindings show f64 and Option as nullable).
 */
export type RelatedHit = Pick<RelatedResult, "id" | "arm"> & {
  score: number;
  arms?: RelatedResult["arm"][];
  similarity?: number;
};

export function findRelated(
  seedId: string,
  deps: {
    graph: { nodes: string[]; edges: Map<string, string[]> };
    lexical?: (seedId: string, limit: number) => { id: string; score: number }[];
    tagged?: (seedId: string, limit: number) => { id: string; score: number }[];
  },
  limit = 10,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): RelatedHit[] {
  return rawFindRelated(
    toWasmGraph(deps.graph),
    seedId,
    limit,
    { numWalks: options.numWalks, maxSteps: options.maxSteps, damping: options.damping },
    options.rng ?? Math.random,
    (s: string, l: number) => deps.lexical?.(s, l) ?? [],
    (s: string, l: number) => deps.tagged?.(s, l) ?? [],
  ) as RelatedHit[];
}
