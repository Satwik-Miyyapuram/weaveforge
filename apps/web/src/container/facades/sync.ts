import type { ManageExperimentUseCase } from "@weaveforge/core";
import type { IIntegrationsStore, IGitClient } from "@/features/sync/domain/sync-ports";

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
}
