import type { ILogSyncIntegration, LogEntry } from "@weaveforge/core";

/** Disabled log-sync provider. */
export class NoopLogSyncIntegration implements ILogSyncIntegration {
  readonly providerId = "none";

  async pushLog(_entry: LogEntry): Promise<void> {
    /* log sync off */
  }

  async removeLog(_entry: LogEntry): Promise<void> {
    /* log sync off */
  }
}
