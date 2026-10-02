import type { CitationCandidate, INotificationIntegration, LogEntry, Milestone, Paper } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { mattermostChannelFor, type MattermostEvent } from "@/features/sync/domain/mattermost-options";
import {
  citationAlertMessage,
  logEntryMessage,
  MattermostNotifier,
  milestoneMessage,
} from "@/features/sync/infrastructure/mattermost-notifier";

export class MattermostNotificationIntegration implements INotificationIntegration {
  readonly providerId = "mattermost";

  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      notifier?: MattermostNotifier;
    },
  ) {}

  notifyMilestone(event: "added" | "status", milestone: Milestone): Promise<void> {
    return this.send(event === "added" ? "milestoneAdded" : "milestoneStatus", () =>
      milestoneMessage(event, milestone),
    );
  }

  notifyCitationAlert(trackedPaper: Paper, citingPapers: CitationCandidate[]): Promise<void> {
    return this.send("citationAlerts", () => citationAlertMessage(trackedPaper, citingPapers));
  }

  notifyLogEntry(entry: LogEntry): Promise<void> {
    return this.send(entry.kind === "weekly" ? "weeklyLogs" : "dailyLogs", () => logEntryMessage(entry));
  }

  /** Posts only when the project switched this event on; routes to its channel. */
  private async send(event: MattermostEvent, message: () => string): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const integration = await this.deps.integrations.get(pid, "mattermost");
    const channel = mattermostChannelFor(integration, event);
    if (!channel) return;
    const notifier = this.deps.notifier ?? new MattermostNotifier();
    await notifier.post(integration, message(), channel);
  }
}
