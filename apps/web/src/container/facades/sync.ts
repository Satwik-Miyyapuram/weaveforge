import type { ManageExperimentUseCase } from "@weaveforge/core";
import type { IIntegrationsStore, IGitClient } from "@/features/sync/domain/sync-ports";
import type { Integration } from "@/features/sync/domain/integration";
import { MATTERMOST_EVENTS, mattermostChannelFor } from "@/features/sync/domain/mattermost-options";
import { MattermostNotifier } from "@/features/sync/infrastructure/mattermost-notifier";

export class SyncFacade {
  constructor(
    private readonly deps: {
      integrations: IIntegrationsStore;
      git: IGitClient;
      manageExperiment: ManageExperimentUseCase;
    },
  ) {}

  get integrations() {
    return this.deps.integrations;
  }
  get git() {
    return this.deps.git;
  }
  get manageExperiment() {
    return this.deps.manageExperiment;
  }

  /** Posts one test message per distinct channel the switched-on events route to. */
  async testMattermost(integration: Integration): Promise<string[]> {
    const byChannel = new Map<string, string[]>();
    for (const e of MATTERMOST_EVENTS) {
      const ch = mattermostChannelFor(integration, e.id);
      if (ch) byChannel.set(ch, [...(byChannel.get(ch) ?? []), e.label]);
    }
    const notifier = new MattermostNotifier();
    for (const [ch, labels] of byChannel) {
      await notifier.post(
        integration,
        `:white_check_mark: WeaveForge test. This channel will receive: ${labels.join(", ")}.`,
        ch,
      );
    }
    return [...byChannel.keys()];
  }
}
