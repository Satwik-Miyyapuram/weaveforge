/** Types for wiki-graph. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { WorkspaceSnapshot } from "../workspace/workspace-snapshot.js";

export interface WikiGraph {
  nodes: string[];
  /** Adjacency, undirected: a link implies relatedness in both directions. */
  edges: Map<string, string[]>;
}

export interface GraphDensity {
  nodes: number;
  edges: number;
  /** Mean degree; the reference cascade uses density to pick an arm. */
  meanDegree: number;
  /** Fraction of nodes in the largest connected component. */
  largestComponentRatio: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface WikiGraphFns {
  /**
 * Build the graph.
 *
 * Wikilink targets resolve note → paper → section, matching the priority the
 * graph screen already uses. Resolution is by normalized title, which is how
 * `[[…]]` autocomplete and backlinks already work, so a link that renders in
 * the app is a link here.
 */
  buildWikiGraph(snapshot: WorkspaceSnapshot): WikiGraph;
  /** Link count per node, for `SearchDoc.degree`. */
  graphDegrees(graph: WikiGraph): Map<string, number>;
  /**
 * Measure the graph. Worth reporting before trusting PPR: on a sparse graph it
 * degrades to "return the seed", and lexical retrieval is the better answer.
 */
  graphDensity(graph: WikiGraph): GraphDensity;
}
