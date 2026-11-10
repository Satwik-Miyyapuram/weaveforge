/**
 * Graph view settings (Rust `relations::graph_settings`), re-exported from index.ts. Each
 * function keeps the signature of packages/core/src/features/relations/domain/
 * graph-view-settings.ts and graph-persisted-state.ts.
 */
import {
  graphFilterCountFor as rawGraphFilterCountFor,
} from "../pkg/wf_wasm.js";
import type {
  GraphViewSettings,
} from "./bindings.js";

export {
  defaultGraphSettings,
  effectiveRelationTypes,
  graphFilterCountFor,
  normalizeGraphViewSettings,
  parseGraphPersistedState,
  showConceptEdges,
  showRelationEdges,
} from "../pkg/wf_wasm.js";

export function graphFilterCount(
  selectedTags: string[],
  selectedLists: string[],
  settings: GraphViewSettings,
): number {
  return rawGraphFilterCountFor(selectedTags.length, selectedLists.length, settings);
}

