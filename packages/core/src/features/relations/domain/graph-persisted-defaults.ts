import { DEFAULT_GRAPH_SETTINGS } from "./graph-view-settings.js";
import type { GraphPersistedState } from "./graph-persisted-state.js";

/** The graph state a project starts with. */
export const DEFAULT_GRAPH_PERSISTED_STATE: GraphPersistedState = {
  settings: DEFAULT_GRAPH_SETTINGS,
  selectedLists: [],
  selectedTags: [],
  localSeed: null,
  localDepth: 2,
  pinned: {},
};