import type { CitationCandidate, INotificationIntegration, LogEntry, Milestone, Paper } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import type { MattermostEvent } from "@/features/sync/domain/mattermost-options";
import type { MattermostNotifier } from "@/features/sync/infrastructure/mattermost-notifier";

type Notifier = typeof import("@/features/sync/infrastructure/mattermost-notifier");

/** Loaded on first post: the layout wires this integration, the notifier is not needed to paint. */
const loadNotifier = (): Promise<Notifier> => import("@/features/sync/infrastructure/mattermost-notifier");

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
    return this.send(event === "added" ? "milestoneAdded" : "milestoneStatus", (m) =>
      m.milestoneMessage(event, milestone),
    );
  }

  notifyCitationAlert(trackedPaper: Paper, citingPapers: CitationCandidate[]): Promise<void> {
    return this.send("citationAlerts", (m) => m.citationAlertMessage(trackedPaper, citingPapers));
  }

  notifyLogEntry(entry: LogEntry): Promise<void> {
    return this.send(entry.kind === "weekly" ? "weeklyLogs" : "dailyLogs", (m) => m.logEntryMessage(entry));
  }

  /** Posts only when the project switched this event on; routes to its channel. */
  private async send(event: MattermostEvent, message: (m: Notifier) => string): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const integration = await this.deps.integrations.get(pid, "mattermost");
    const { mattermostChannelFor } = await import("@/features/sync/domain/mattermost-options");
    const channel = mattermostChannelFor(integration, event);
    if (!channel) return;
    const m = await loadNotifier();
    const notifier = this.deps.notifier ?? new m.MattermostNotifier();
    await notifier.post(integration, message(m), channel);
  }
}
