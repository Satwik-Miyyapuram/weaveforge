/**
 * Citation-graph builder (Rust `graph_build`), re-exported from index.ts.
 * Keeps the signature of apps/web/src/features/relations/application/build-graph-data.ts.
 * Maps and Sets are converted here, so the wasm side only sees plain objects and arrays.
 */
import { buildGraphData as rawBuildGraphData } from "../pkg/wf_wasm.js";
import type {
  GraphBuildExperiment,
  GraphBuildList,
  GraphBuildNote,
  GraphBuildPaper,
  GraphBuildSection,
  GraphLink,
  GraphNode,
  GraphViewSettings,
  PaperRelation,
} from "./bindings.js";

export type { GraphBuildExperiment } from "./bindings.js";
export type { GraphLink as GLink } from "./bindings.js";

/** A graph node, with the layout fields the force graph writes in place. */
/** Narrowing: extends generated GraphNode with force-layout fields (x, y, fx, fy). */
export type GNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };

/** One graph view and its lookups. */
/** Narrowing: Maps and Sets here; wasm returns plain records. */
export interface GraphBuildOutput {
  data: { nodes: GNode[]; links: GraphLink[] };
  /** Node id to the ids it is linked to. */
  neighbors: Map<string, Set<string>>;
  /** Tag to the papers that carry it or sit in a list of that name. */
  tagToPapers: Map<string, string[]>;
  /** Tag to the notes that carry it or sit in a list of that name. */
  tagToNotes: Map<string, string[]>;
}

/** Builds nodes, links and lookups for one graph view. */
export function buildGraphData(
  papers: GraphBuildPaper[],
  relations: PaperRelation[],
  settings: GraphViewSettings,
  membership: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  lists: GraphBuildList[] = [],
  notes: GraphBuildNote[] = [],
  sections: GraphBuildSection[] = [],
  experiments: GraphBuildExperiment[] = [],
): GraphBuildOutput {
  const raw = rawBuildGraphData({
    papers,
    relations,
    settings,
    membership: Object.fromEntries([...membership].map(([id, set]) => [id, [...set]])),
    lists,
    notes,
    sections,
    experiments,
  }) as {
    data: { nodes: GNode[]; links: GraphLink[] };
    neighbors: Record<string, string[]>;
    tagToPapers: Record<string, string[]>;
    tagToNotes: Record<string, string[]>;
  };
  return {
    data: raw.data,
    neighbors: new Map(Object.entries(raw.neighbors).map(([id, ids]) => [id, new Set(ids)])),
    tagToPapers: new Map(Object.entries(raw.tagToPapers)),
    tagToNotes: new Map(Object.entries(raw.tagToNotes)),
  };
}
