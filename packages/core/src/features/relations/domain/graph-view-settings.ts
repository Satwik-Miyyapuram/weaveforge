import type { RelationType } from "./paper-relation.js";
import { RELATION_TYPES } from "./paper-relation.js";

export type EdgeMode = "cites" | "tags" | "both";
export type ColorBy = "status" | "tag" | "list";
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
};

const EDGE_MODES = new Set<EdgeMode>(["cites", "tags", "both"]);
const COLOR_BY = new Set<ColorBy>(["status", "tag", "list"]);
const GROUP_BY = new Set<GroupBy>(["none", "status", "list"]);
const LAYOUTS = new Set<LayoutMode>(["force", "timeline"]);
const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

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
