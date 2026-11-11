/** Types for graph-persisted-state. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { GraphViewSettings } from "./graph-view-settings.js";

export interface GraphPinnedPosition {
  x: number;
  y: number;
}

/** Per-project graph UI state synced across devices (stored on the project row). */
export interface GraphPersistedState {
  settings: GraphViewSettings;
  selectedLists: string[];
  selectedTags: string[];
  localSeed: string | null;
  localDepth: number;
  pinned: Record<string, GraphPinnedPosition>;
}

export { DEFAULT_GRAPH_PERSISTED_STATE } from "./graph-persisted-defaults.js";

