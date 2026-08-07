/**
 * "Related to this" — a three-arm cascade, because no single retrieval strategy
 * is right across the range of workspaces this has to serve.
 *
 * On a densely linked workspace, graph expansion finds things a keyword search
 * never would. On a sparse one — which is most workspaces early on — PPR
 * degrades to "here is the seed and nothing else", and lexical similarity is
 * genuinely the better answer. The arm used is reported so the UI can say why,
 * rather than silently returning a worse result.
 */

import { relatedByPpr, type PprOptions } from "./personalized-pagerank.js";
import { graphDegrees, type WikiGraph } from "./wiki-graph.js";

export type RelatedArm = "graph" | "lexical" | "tags" | "none";

export interface RelatedResult {
  id: string;
  score: number;
  arm: RelatedArm;
}

/** Below this the seed has too little neighbourhood for a walk to say anything. */
export const MIN_SEED_DEGREE_FOR_PPR = 3;

export interface RelatedDeps {
  graph: WikiGraph;
  /** Lexical fallback: more-like-this over the seed's own text. */
  lexical?(seedId: string, limit: number): readonly { id: string; score: number }[];
  /** Last resort: documents sharing a tag with the seed. */
  tagged?(seedId: string, limit: number): readonly { id: string; score: number }[];
}

/**
 * Related documents for a seed, trying graph expansion first and falling back.
 *
 * Each arm is tried in turn and the first non-empty one wins; an arm returning
 * nothing is not an error, it is information about the workspace.
 */
export function findRelated(
  seedId: string,
  deps: RelatedDeps,
  limit = 10,
  options: PprOptions = {},
): RelatedResult[] {
  const degree = graphDegrees(deps.graph).get(seedId) ?? 0;

  if (degree >= MIN_SEED_DEGREE_FOR_PPR) {
    const hits = relatedByPpr(deps.graph, seedId, limit, options);
    if (hits.length > 0) {
      return hits.map((hit) => ({ ...hit, arm: "graph" as const }));
    }
  }

  const lexical = deps.lexical?.(seedId, limit) ?? [];
  if (lexical.length > 0) {
    return lexical.map((hit) => ({ ...hit, arm: "lexical" as const }));
  }

  const tagged = deps.tagged?.(seedId, limit) ?? [];
  if (tagged.length > 0) {
    return tagged.map((hit) => ({ ...hit, arm: "tags" as const }));
  }

  return [];
}

/** Human-readable reason, so a thin result set is explained rather than puzzling. */
export function explainArm(arm: RelatedArm): string {
  switch (arm) {
    case "graph":
      return "From links between your notes and papers";
    case "lexical":
      return "By similar wording — not enough links yet for the graph";
    case "tags":
      return "By shared tags";
    default:
      return "Nothing related found yet";
  }
}
