import type {
  CitationCandidate,
  INotificationIntegration,
  LogEntry,
  Milestone,
  Paper,
} from "@weaveforge/core";

/** Disabled notification provider. */
export class NoopNotificationIntegration implements INotificationIntegration {
  readonly providerId = "none";

  async notifyMilestone(_event: "added" | "status", _milestone: Milestone): Promise<void> {
    /* notifications off */
  }

  async notifyCitationAlert(_tracked: Paper, _citing: CitationCandidate[]): Promise<void> {
    /* notifications off */
  }

  async notifyLogEntry(_entry: LogEntry): Promise<void> {
    /* notifications off */
  }
}
