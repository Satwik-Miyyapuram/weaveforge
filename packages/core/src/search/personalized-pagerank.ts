/**
 * Monte Carlo Personalized PageRank (Fogaras et al., 2005).
 *
 * Adapted from the approach in green-dalii/obsidian-llm-wiki (Apache-2.0).
 *
 * Monte Carlo rather than power iteration because its cost is K×L walks
 * regardless of graph size: a 2000-node workspace costs the same per query as a
 * 200-node one. For a client-side index that matters more than exactness — the
 * top-k is robust to sampling noise.
 */

import type { WikiGraph } from "./wiki-graph.js";

export interface PprOptions {
  numWalks?: number;
  maxSteps?: number;
  /** Teleport probability back to the seed. */
  damping?: number;
  /** Injected for deterministic tests; production uses Math.random. */
  rng?: () => number;
}

const DEFAULT_NUM_WALKS = 3_000;
const DEFAULT_MAX_STEPS = 50;
const DEFAULT_DAMPING = 0.15;

/**
 * Visit probabilities from `seed`, as a map of node → score.
 *
 * A seed with no edges keeps all its probability, which is the correct answer:
 * an unlinked document has no neighbourhood, and the caller should fall back to
 * lexical retrieval rather than treat that as a result.
 */
export function personalizedPageRank(
  graph: WikiGraph,
  seed: string,
  options: PprOptions = {},
): Map<string, number> {
  if (!graph.edges.has(seed)) return new Map();

  const numWalks = options.numWalks ?? DEFAULT_NUM_WALKS;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const damping = options.damping ?? DEFAULT_DAMPING;
  const rng = options.rng ?? Math.random;

  const visits = new Map<string, number>();
  const record = (node: string) => visits.set(node, (visits.get(node) ?? 0) + 1);

  for (let walk = 0; walk < numWalks; walk += 1) {
    let current = seed;
    for (let step = 0; step < maxSteps; step += 1) {
      const neighbours = graph.edges.get(current);
      // Teleport, or restart from a dead end — the standard Haveliwala rule,
      // which stops walks getting stuck on nodes with no way out.
      if (rng() < damping || !neighbours || neighbours.length === 0) {
        current = seed;
        record(current);
        continue;
      }
      const next = neighbours[Math.floor(rng() * neighbours.length)];
      if (next === undefined) {
        current = seed;
        record(current);
        continue;
      }
      current = next;
      record(current);
    }
  }

  let total = 0;
  for (const count of visits.values()) total += count;
  if (total === 0) return new Map();

  const scores = new Map<string, number>();
  for (const [node, count] of visits) scores.set(node, count / total);
  return scores;
}

export interface RelatedNode {
  id: string;
  score: number;
}

/** Top-k neighbours by PPR, excluding the seed itself. */
export function relatedByPpr(
  graph: WikiGraph,
  seed: string,
  limit = 10,
  options: PprOptions = {},
): RelatedNode[] {
  const scores = personalizedPageRank(graph, seed, options);
  return [...scores.entries()]
    .filter(([node]) => node !== seed)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
