import type { ManageExperimentUseCase } from "@weaveforge/core";
import type { IIntegrationsStore, IGitClient } from "@/features/sync/domain/sync-ports";
import type { Integration } from "@/features/sync/domain/integration";

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

  /** Loaded on demand: the layout reaches this facade, the test post is settings-only. */
  async testMattermost(integration: Integration): Promise<string[]> {
    const { postMattermostTest } = await import("@/features/sync/infrastructure/mattermost-test-post");
    return postMattermostTest(integration);
  }
}
