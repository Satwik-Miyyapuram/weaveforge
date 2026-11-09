/** Types for personalized-pagerank. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { WikiGraph } from "./wiki-graph.js";

export interface PprOptions {
  numWalks?: number;
  maxSteps?: number;
  /** Teleport probability back to the seed. */
  damping?: number;
  /** Injected for deterministic tests; production uses Math.random. */
  rng?: () => number;
}

export interface RelatedNode {
  id: string;
  score: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PersonalizedPagerankFns {
  /**
 * Visit probabilities from `seed`, as a map of node → score.
 *
 * A seed with no edges keeps all its probability, which is the correct answer:
 * an unlinked document has no neighbourhood, and the caller should fall back to
 * lexical retrieval rather than treat that as a result.
 */
  personalizedPageRank(graph: WikiGraph, seed: string, options?: PprOptions): Map<string, number>;
  /** Top-k neighbours by PPR, excluding the seed itself. */
  relatedByPpr(graph: WikiGraph, seed: string, limit?: number, options?: PprOptions): RelatedNode[];
}
