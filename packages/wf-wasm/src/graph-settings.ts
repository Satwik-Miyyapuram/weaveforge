/**
 * Graph view settings (Rust `relations::graph_settings`), re-exported from index.ts. Each
 * function keeps the signature of packages/core/src/features/relations/domain/
 * graph-view-settings.ts and graph-persisted-state.ts.
 */
import {
  defaultGraphSettings as rawDefaultGraphSettings,
  effectiveRelationTypes as rawEffectiveRelationTypes,
  graphFilterCountFor as rawGraphFilterCountFor,
  normalizeGraphViewSettings as rawNormalizeGraphViewSettings,
  parseGraphPersistedState as rawParseGraphPersistedState,
  showConceptEdges as rawShowConceptEdges,
  showRelationEdges as rawShowRelationEdges,
} from "../pkg/wf_wasm.js";
import type { GraphPersistedState, GraphViewSettings, RelationType } from "./bindings.js";

/** A fresh copy of the default settings (TS `DEFAULT_GRAPH_SETTINGS`). */
export function defaultGraphSettings(): GraphViewSettings {
  return rawDefaultGraphSettings() as GraphViewSettings;
}

/** Merge partial settings with defaults and sanitize enum/number fields. */
export function normalizeGraphViewSettings(raw: unknown): GraphViewSettings {
  return rawNormalizeGraphViewSettings(raw) as GraphViewSettings;
}

export function effectiveRelationTypes(settings: GraphViewSettings): RelationType[] {
  return rawEffectiveRelationTypes(settings) as RelationType[];
}

export function showRelationEdges(settings: GraphViewSettings): boolean {
  return rawShowRelationEdges(settings);
}

export function showConceptEdges(settings: GraphViewSettings): boolean {
  return rawShowConceptEdges(settings);
}

/** Active filter count from the tag and list selection sizes. */
export function graphFilterCountFor(tagCount: number, listCount: number, settings: GraphViewSettings): number {
  return rawGraphFilterCountFor(tagCount, listCount, settings);
}

export function graphFilterCount(
  selectedTags: string[],
  selectedLists: string[],
  settings: GraphViewSettings,
): number {
  return rawGraphFilterCountFor(selectedTags.length, selectedLists.length, settings);
}

/** Parse graph state JSON from persistence; returns null when payload is absent. */
export function parseGraphPersistedState(raw: unknown): GraphPersistedState | null {
  return rawParseGraphPersistedState(raw) as GraphPersistedState | null;
}
