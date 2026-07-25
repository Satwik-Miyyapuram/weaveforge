import type { LogEntry } from "@thesis/core";
import type { IGitLabLogExporter, IIntegrationsStore } from "../domain/sync-ports";

export class SyncLogEntryUseCase {
  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      exporter: IGitLabLogExporter;
    },
  ) {}

  async push(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    await this.deps.exporter.push(await this.deps.integrations.get(pid, "gitlab"), entry);
  }

  async remove(entry: LogEntry): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    await this.deps.exporter.remove(await this.deps.integrations.get(pid, "gitlab"), entry);
  }
}
