/** Types for wiki-graph. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

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

