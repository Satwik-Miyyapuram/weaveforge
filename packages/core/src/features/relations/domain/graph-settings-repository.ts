import type { GraphPersistedState } from "./graph-persisted-state.js";

/** Per-project graph view preferences (stored on the project row). */
export interface IGraphSettingsRepository {
  get(projectId: string): Promise<GraphPersistedState | null>;
  save(projectId: string, state: GraphPersistedState): Promise<void>;
}
