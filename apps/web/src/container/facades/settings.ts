import type { IBibliographyIntegration, ManageSettingsUseCase } from "@weaveforge/core";
import type { IProjectBibliographyCollectionStore } from "@weaveforge/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";

export class SettingsFacade {
  constructor(
    private readonly deps: {
      settings: ManageSettingsUseCase;
      bibliography: IBibliographyIntegration;
      projectBibliography: IProjectBibliographyCollectionStore;
      integrations: IIntegrationsStore;
    },
  ) {}

  get manageSettings() {
    return this.deps.settings;
  }
  get integrations() {
    return this.deps.integrations;
  }

  /**
   * `credentials` are the values typed into the connection form; without them
   * the provider falls back to whatever is stored.
   */
  listBibliographyCollections(
    credentials?: import("@weaveforge/core").BibliographyCredentials,
  ) {
    return this.deps.bibliography.listCollections(credentials);
  }

  getProjectCollection(projectId: string) {
    return this.deps.projectBibliography.getCollection(projectId);
  }

  setProjectCollection(projectId: string, collection: string | null) {
    return this.deps.projectBibliography.setCollection(projectId, collection);
  }
}
