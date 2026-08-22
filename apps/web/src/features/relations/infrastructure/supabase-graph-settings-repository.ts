import type { SupabaseClient } from "@supabase/supabase-js";
import type { GraphPersistedState, IGraphSettingsRepository } from "@weaveforge/core";
import { parseGraphPersistedState } from "@weaveforge/core";
import { run } from "@/backend/providers/supabase/row-access";

const TABLE = "projects";

export class SupabaseGraphSettingsRepository implements IGraphSettingsRepository {
  constructor(private readonly db: SupabaseClient) {}

  async get(projectId: string): Promise<GraphPersistedState | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("graph_settings")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.graph_settings) return null;
    return parseGraphPersistedState(data.graph_settings);
  }

  async save(projectId: string, state: GraphPersistedState): Promise<void> {
    await run(this.db
      .from(TABLE)
      .update({ graph_settings: state })
      .eq("id", projectId));
  }
}
