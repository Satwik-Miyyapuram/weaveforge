import type { ILogSyncIntegration, LogEntry } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { GitLabLogExporter } from "@/features/sync/infrastructure/gitlab-log-exporter";

export class GitLabLogSyncIntegration implements ILogSyncIntegration {
  readonly providerId = "gitlab";

  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      exporter?: GitLabLogExporter;
    },
  ) {}

  async pushLog(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const exporter = this.deps.exporter ?? new GitLabLogExporter();
    await exporter.push(await this.deps.integrations.get(pid, "gitlab"), entry);
  }

  async removeLog(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const exporter = this.deps.exporter ?? new GitLabLogExporter();
    await exporter.remove(await this.deps.integrations.get(pid, "gitlab"), entry);
  }
}
