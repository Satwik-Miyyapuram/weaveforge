/** Types for graph-view-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { RelationType } from "./paper-relation.js";

export type EdgeMode = "cites" | "tags" | "both";

/**
 * What a node's colour says. `status`, `tag` and `list` describe a paper;
 * `type` gives each kind of node its own colour; `year` and `degree` run a
 * light-to-dark ramp over the publication year and the number of links;
 * `cluster` colours each densely linked community apart (label propagation),
 * the way Gephi colours by modularity; `groups` applies the person's own
 * query → colour rules, first match wins, the way Obsidian's graph groups do.
 * Shapes never change with it: they always name the kind.
 */
export type ColorBy = "status" | "tag" | "list" | "type" | "year" | "degree" | "cluster" | "groups";

/** One custom colour rule: `tag:x`, `list:x`, `status:x`, or words in the title. */
export interface ColorGroup {
  query: string;
  color: string;
}

export type GroupBy = "none" | "status" | "list";

/**
 * How nodes are arranged, as opposed to how they are coloured.
 *
 * `force` is the ordinary physics layout. `timeline` pins each paper's x to
 * its publication year, so the graph reads left to right as the literature
 * actually developed, and leaves y to the forces — related work still clumps
 * vertically, but a citation can no longer point backwards in time on screen.
 *
 * `groupBy` sounds like it ought to live here and does not: despite the name
 * it only picks the colouring, and changing that now would silently rearrange
 * saved views.
 */
export type LayoutMode = "force" | "timeline";

/**
 * Where node colours come from. `theme` takes the active theme's chip colours
 * (the brutal themes define them; the others fall back to the classic set), so
 * the graph agrees with the status chips on the Papers page. `classic` keeps
 * the muted original palette in every theme.
 */
export type NodePalette = "theme" | "classic";

/** The node colours a person can override. Tags keep their per-tag hue. */
export const NODE_COLOR_KEYS = ["paper", "to_read", "reading", "read", "skimmed", "note", "report", "experiment"] as const;

export type NodeColorKey = (typeof NODE_COLOR_KEYS)[number];

/**
 * A run, as the graph needs it.
 *
 * Here rather than in the graph feature because the container's facade returns
 * it, and a facade in `container/` importing from `features/relations/` would be
 * the dependency pointing the wrong way — core is the layer both can reach.
 *
 * Narrower than `Experiment` on purpose: the graph draws a run's name, its
 * status and the paper it tests, and nothing else. Handing it whole entities
 * would put metric payloads and config blobs into a node array that
 * react-force-graph clones on every layout pass.
 */
export interface GraphExperimentEntry {
  id: string;
  name: string;
  status: string;
  /** The paper this run tests — the edge that puts a run on the graph at all. */
  relatedPaper?: string;
  /**
   * The run's hypothesis and result note, joined. Not a node of its own: its
   * `[[wikilinks]]` become edges from the run's single node.
   */
  note?: string;
}

export interface GraphViewSettings {
  edgeMode: EdgeMode;
  colorBy: ColorBy;
  groupBy: GroupBy;
  layout: LayoutMode;
  showConcepts: boolean;
  minConceptDegree: number;
  hideOrphans: boolean;
  relationTypes: RelationType[];
  showConceptCooccurrence: boolean;
  searchQuery: string;
  textFadeThreshold: number;
  nodeSize: number;
  linkThickness: number;
  showAutoStyle: boolean;
  centerStrength: number;
  chargeStrength: number;
  linkDistance: number;
  nodePalette: NodePalette;
  /** Per-kind colour overrides, as `#rrggbb`. Missing keys follow the palette. */
  nodeColors: Partial<Record<NodeColorKey, string>>;
  /** Rules for `colorBy: "groups"`, in priority order. */
  colorGroups: ColorGroup[];
  /** When true, reading lists act as concept nodes linking member papers and notes. */
  includeListsAsConcepts?: boolean;
  /** When true, node and text screen sizes are clamped during high zoom to prevent occlusion of edges. */
  boundedZoomScale?: boolean;
}

export const DEFAULT_GRAPH_SETTINGS: GraphViewSettings = {
  edgeMode: "cites",
  colorBy: "status",
  groupBy: "none",
  layout: "force",
  showConcepts: false,
  minConceptDegree: 2,
  hideOrphans: true,
  relationTypes: ["cites"],
  showConceptCooccurrence: false,
  searchQuery: "",
  textFadeThreshold: 0.55,
  nodeSize: 1,
  linkThickness: 1,
  showAutoStyle: true,
  centerStrength: 0.05,
  chargeStrength: -22,
  linkDistance: 24,
  nodePalette: "theme",
  nodeColors: {},
  colorGroups: [],
  includeListsAsConcepts: true,
  boundedZoomScale: true,
};

/** Enough rules to be useful, few enough that the legend still fits. */
export const MAX_COLOR_GROUPS = 12;

