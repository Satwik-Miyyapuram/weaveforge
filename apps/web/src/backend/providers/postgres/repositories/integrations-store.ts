import {
  emptyIntegration,
  type Integration,
  type SyncProvider,
} from "@/features/sync/domain/integration";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import type { PgRunner } from "../pg-runner";
import {
  type IntegrationRow,
} from "@/features/sync/infrastructure/integrations-rows";

export class PostgresIntegrationsStore implements IIntegrationsStore {
  constructor(private readonly pg: PgRunner) {}

  async get(projectId: string, provider: SyncProvider): Promise<Integration> {
    const row = await this.pg.queryOne<IntegrationRow>(
      `select provider, enabled, token, repo, branch
       from project_integrations
       where project_id = $1 and provider = $2`,
      [projectId, provider],
    );
    if (!row) return emptyIntegration(provider);
    return {
      provider,
      enabled: row.enabled,
      token: row.token ?? undefined,
      repo: row.repo ?? undefined,
      branch: row.branch ?? "main",
    };
  }

  async save(projectId: string, integration: Integration): Promise<void> {
    await this.pg.exec(
      `insert into project_integrations
         (project_id, provider, enabled, token, repo, branch, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (project_id, provider) do update set
         enabled = excluded.enabled,
         token = excluded.token,
         repo = excluded.repo,
         branch = excluded.branch,
         updated_at = excluded.updated_at`,
      [
        projectId,
        integration.provider,
        integration.enabled,
        integration.token ?? null,
        integration.repo ?? null,
        integration.branch || "main",
        new Date().toISOString(),
      ],
    );
  }
}
