/**
 * Wiki-link graph (Rust `search::wiki_graph`), re-exported from index.ts. Each function keeps the
 * signature of packages/core/src/search/wiki-graph.ts. The wasm side sends `edges` as an array of
 * `{ node, neighbours }` rows, so these wrappers convert to and from the TS `Map` form.
 */
import {
  buildWikiGraph as rawBuildWikiGraph,
  graphDegrees as rawGraphDegrees,
  graphDensity as rawGraphDensity,
} from "../pkg/wf_wasm.js";
import type { GraphDensity, WikiGraph, WikiGraphDegree } from "./bindings.js";

/** Build the graph: nodes `kind:id`, undirected adjacency in insertion order. */
export function buildWikiGraph(snapshot: object): {
  nodes: string[];
  edges: Map<string, string[]>;
} {
  const wire: WikiGraph = rawBuildWikiGraph(snapshot);
  return {
    nodes: wire.nodes,
    edges: new Map(wire.edges.map((entry): [string, string[]] => [entry.node, entry.neighbours])),
  };
}

/** Link count per node, for `SearchDoc.degree`. */
export function graphDegrees(graph: {
  nodes: string[];
  edges: Map<string, string[]>;
}): Map<string, number> {
  const wire: WikiGraph = {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
  const rows: WikiGraphDegree[] = rawGraphDegrees(wire);
  return new Map(rows.map((row): [string, number] => [row.node, row.degree ?? 0]));
}

/** Measure the graph: node and edge counts, mean degree, largest component share. */
export function graphDensity(graph: {
  nodes: string[];
  edges: Map<string, string[]>;
}): GraphDensity {
  const wire: WikiGraph = {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
  return rawGraphDensity(wire) as GraphDensity;
}
