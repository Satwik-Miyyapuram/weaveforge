import type { CitationCandidate, INotificationIntegration, Milestone, Paper } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import {
  citationAlertMessage,
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

  async notifyMilestone(event: "added" | "status", milestone: Milestone): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const notifier = this.deps.notifier ?? new MattermostNotifier();
    await notifier.post(
      await this.deps.integrations.get(pid, "mattermost"),
      milestoneMessage(event, milestone),
    );
  }

  async notifyCitationAlert(trackedPaper: Paper, citingPapers: CitationCandidate[]): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    const notifier = this.deps.notifier ?? new MattermostNotifier();
    await notifier.post(
      await this.deps.integrations.get(pid, "mattermost"),
      citationAlertMessage(trackedPaper, citingPapers),
    );
  }
}
