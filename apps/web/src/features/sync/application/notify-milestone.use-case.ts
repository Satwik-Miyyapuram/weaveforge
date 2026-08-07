import type { Milestone } from "@weaveforge/core";
import type { IIntegrationsStore, IMattermostNotifier } from "../domain/sync-ports";
import { milestoneMessage } from "../infrastructure/mattermost-notifier";

export class NotifyMilestoneUseCase {
  constructor(
    private readonly deps: {
      projectId: () => string | null;
      integrations: IIntegrationsStore;
      notifier: IMattermostNotifier;
    },
  ) {}

  async execute(event: "added" | "status", milestone: Milestone): Promise<void> {
    const pid = this.deps.projectId();
    if (!pid) return;
    await this.deps.notifier.post(
      await this.deps.integrations.get(pid, "mattermost"),
      milestoneMessage(event, milestone),
    );
  }
}
