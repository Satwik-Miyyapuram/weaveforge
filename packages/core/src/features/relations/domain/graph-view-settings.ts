import type { RelationType } from "./paper-relation.js";
import { RELATION_TYPES } from "./paper-relation.js";

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

const EDGE_MODES = new Set<EdgeMode>(["cites", "tags", "both"]);
const COLOR_BY = new Set<ColorBy>(["status", "tag", "list", "type", "year", "degree", "cluster", "groups"]);
const GROUP_BY = new Set<GroupBy>(["none", "status", "list"]);
const LAYOUTS = new Set<LayoutMode>(["force", "timeline"]);
const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);
const PALETTES = new Set<NodePalette>(["theme", "classic"]);
const HEX = /^#[0-9a-f]{6}$/i;

function normalizeNodeColors(raw: unknown): Partial<Record<NodeColorKey, string>> {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<NodeColorKey, string>> = {};
  for (const key of NODE_COLOR_KEYS) {
    const v = src[key];
    if (typeof v === "string" && HEX.test(v)) out[key] = v.toLowerCase();
  }
  return out;
}

/** Enough rules to be useful, few enough that the legend still fits. */
export const MAX_COLOR_GROUPS = 12;

function normalizeColorGroups(raw: unknown): ColorGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ColorGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const { query, color } = g as Record<string, unknown>;
    if (typeof query !== "string" || typeof color !== "string" || !HEX.test(color)) continue;
    out.push({ query: query.slice(0, 80), color: color.toLowerCase() });
    if (out.length === MAX_COLOR_GROUPS) break;
  }
  return out;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Merge partial settings with defaults and sanitize enum/number fields. */
export function normalizeGraphViewSettings(raw: unknown): GraphViewSettings {
  const o = raw && typeof raw === "object" ? (raw as Partial<GraphViewSettings>) : {};
  const relationTypes = Array.isArray(o.relationTypes)
    ? o.relationTypes.filter((t): t is RelationType => RELATION_TYPE_SET.has(t))
    : DEFAULT_GRAPH_SETTINGS.relationTypes;
  return {
    edgeMode: EDGE_MODES.has(o.edgeMode as EdgeMode)
      ? (o.edgeMode as EdgeMode)
      : DEFAULT_GRAPH_SETTINGS.edgeMode,
    colorBy: COLOR_BY.has(o.colorBy as ColorBy)
      ? (o.colorBy as ColorBy)
      : DEFAULT_GRAPH_SETTINGS.colorBy,
    groupBy: GROUP_BY.has(o.groupBy as GroupBy)
      ? (o.groupBy as GroupBy)
      : DEFAULT_GRAPH_SETTINGS.groupBy,
    layout: LAYOUTS.has(o.layout as LayoutMode)
      ? (o.layout as LayoutMode)
      : DEFAULT_GRAPH_SETTINGS.layout,
    showConcepts: typeof o.showConcepts === "boolean" ? o.showConcepts : DEFAULT_GRAPH_SETTINGS.showConcepts,
    minConceptDegree: isNumber(o.minConceptDegree) ? o.minConceptDegree : DEFAULT_GRAPH_SETTINGS.minConceptDegree,
    hideOrphans: typeof o.hideOrphans === "boolean" ? o.hideOrphans : DEFAULT_GRAPH_SETTINGS.hideOrphans,
    relationTypes: relationTypes.length > 0 ? relationTypes : DEFAULT_GRAPH_SETTINGS.relationTypes,
    showConceptCooccurrence:
      typeof o.showConceptCooccurrence === "boolean"
        ? o.showConceptCooccurrence
        : DEFAULT_GRAPH_SETTINGS.showConceptCooccurrence,
    searchQuery: typeof o.searchQuery === "string" ? o.searchQuery : DEFAULT_GRAPH_SETTINGS.searchQuery,
    textFadeThreshold: isNumber(o.textFadeThreshold)
      ? o.textFadeThreshold
      : DEFAULT_GRAPH_SETTINGS.textFadeThreshold,
    nodeSize: isNumber(o.nodeSize) ? o.nodeSize : DEFAULT_GRAPH_SETTINGS.nodeSize,
    linkThickness: isNumber(o.linkThickness) ? o.linkThickness : DEFAULT_GRAPH_SETTINGS.linkThickness,
    showAutoStyle:
      typeof o.showAutoStyle === "boolean" ? o.showAutoStyle : DEFAULT_GRAPH_SETTINGS.showAutoStyle,
    centerStrength: isNumber(o.centerStrength)
      ? o.centerStrength
      : DEFAULT_GRAPH_SETTINGS.centerStrength,
    chargeStrength: isNumber(o.chargeStrength)
      ? o.chargeStrength
      : DEFAULT_GRAPH_SETTINGS.chargeStrength,
    linkDistance: isNumber(o.linkDistance) ? o.linkDistance : DEFAULT_GRAPH_SETTINGS.linkDistance,
    nodePalette: PALETTES.has(o.nodePalette as NodePalette)
      ? (o.nodePalette as NodePalette)
      : DEFAULT_GRAPH_SETTINGS.nodePalette,
    nodeColors: normalizeNodeColors(o.nodeColors),
    colorGroups: normalizeColorGroups(o.colorGroups),
    includeListsAsConcepts:
      typeof o.includeListsAsConcepts === "boolean"
        ? o.includeListsAsConcepts
        : DEFAULT_GRAPH_SETTINGS.includeListsAsConcepts,
    boundedZoomScale:
      typeof o.boundedZoomScale === "boolean"
        ? o.boundedZoomScale
        : DEFAULT_GRAPH_SETTINGS.boundedZoomScale,
  };
}

export function effectiveRelationTypes(settings: GraphViewSettings): RelationType[] {
  if (!showRelationEdges(settings)) return [];
  const types = settings.relationTypes?.length ? settings.relationTypes : (["cites"] as const);
  return [...types];
}

export function showRelationEdges(settings: GraphViewSettings): boolean {
  return settings.edgeMode === "cites" || settings.edgeMode === "both";
}

export function showConceptEdges(settings: GraphViewSettings): boolean {
  return settings.showConcepts || settings.edgeMode === "tags" || settings.edgeMode === "both";
}

export function graphFilterCount(
  selectedTags: string[],
  selectedLists: string[],
  settings: GraphViewSettings,
): number {
  let n = 0;
  if (selectedTags.length > 0) n++;
  if (selectedLists.length > 0) n++;
  if (settings.edgeMode !== "cites") n++;
  if (settings.colorBy !== "status") n++;
  if (settings.showConcepts) n++;
  if (settings.hideOrphans) n++;
  if (settings.searchQuery.trim()) n++;
  if (settings.groupBy !== "none") n++;
  if (settings.layout !== "force") n++;
  return n;
}
