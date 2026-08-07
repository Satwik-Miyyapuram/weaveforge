import {
  parseGraphPersistedState,
  type GraphPersistedState,
  type IGraphSettingsRepository,
} from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";

type Row = {
  graph_settings: unknown;
};

export class PostgresGraphSettingsRepository implements IGraphSettingsRepository {
  constructor(private readonly pg: PgRunner) {}

  async get(projectId: string): Promise<GraphPersistedState | null> {
    const row = await this.pg.queryOne<Row>(
      "select graph_settings from projects where id = $1",
      [projectId],
    );
    if (!row?.graph_settings) return null;
    return parseGraphPersistedState(row.graph_settings);
  }

  async save(projectId: string, state: GraphPersistedState): Promise<void> {
    await this.pg.exec("update projects set graph_settings = $1 where id = $2", [
      state,
      projectId,
    ]);
  }
}
