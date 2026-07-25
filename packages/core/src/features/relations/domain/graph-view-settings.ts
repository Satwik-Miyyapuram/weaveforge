import type { RelationType } from "./paper-relation.js";
import { RELATION_TYPES } from "./paper-relation.js";

export type EdgeMode = "cites" | "tags" | "both";
export type ColorBy = "status" | "tag" | "list";
export type GroupBy = "none" | "status" | "list";

export interface GraphViewSettings {
  edgeMode: EdgeMode;
  colorBy: ColorBy;
  groupBy: GroupBy;
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
  return n;
}
