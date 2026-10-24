import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_GIT_BRANCH,
  emptyIntegration,
  type Integration,
  type SyncProvider,
} from "../domain/integration";
import {
  type IntegrationRow,
} from "./integrations-rows";
import { run } from "@/backend/providers/postgrest/row-access";

/** Reads/writes `project_integrations` per (project, provider). */
export class PostgrestIntegrationsStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(projectId: string, provider: SyncProvider): Promise<Integration> {
    const { data, error } = await this.db
      .from("project_integrations")
      .select("provider,enabled,token,repo,branch,options")
      .eq("project_id", projectId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!data) return emptyIntegration(provider);
    const r = data as IntegrationRow;
    return {
      provider,
      enabled: r.enabled,
      token: r.token ?? undefined,
      repo: r.repo ?? undefined,
      branch: r.branch ?? DEFAULT_GIT_BRANCH,
      options: r.options ?? undefined,
    };
  }

  async save(projectId: string, integration: Integration): Promise<void> {
    await run(this.db.from("project_integrations").upsert(
      {
        project_id: projectId,
        provider: integration.provider,
        enabled: integration.enabled,
        token: integration.token ?? null,
        repo: integration.repo ?? null,
        branch: integration.branch || DEFAULT_GIT_BRANCH,
        options: integration.options ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,provider" },
    ));
  }
}
