import type { GraphPersistedState } from "../features/relations/domain/graph-persisted-state.js";
import type { IGraphSettingsRepository } from "../features/relations/domain/graph-settings-repository.js";

export class InMemoryGraphSettingsRepository implements IGraphSettingsRepository {
  private readonly states = new Map<string, GraphPersistedState>();

  async get(projectId: string): Promise<GraphPersistedState | null> {
    const state = this.states.get(projectId);
    return state ? structuredClone(state) : null;
  }

  async save(projectId: string, state: GraphPersistedState): Promise<void> {
    this.states.set(projectId, structuredClone(state));
  }
}
