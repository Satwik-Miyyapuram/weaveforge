import type {
  AddPaperUseCase,
  IPaperRepository,
  IProjectBibliographyCollectionStore,
  ISettingsRepository,
  ManageSettingsUseCase,
  ManageTagsUseCase,
} from "@thesis/core";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import type { ProjectContext } from "@/lib/project-context";
import type { IntegrationConfig } from "./config";

export interface WireIntegrationsDeps {
  projectContext: ProjectContext;
  integrationsStore: IIntegrationsStore;
  manageSettings: ManageSettingsUseCase;
  settingsRepository: ISettingsRepository;
  paperRepository: IPaperRepository;
  manageTags: ManageTagsUseCase;
  addPaper: AddPaperUseCase;
  projectBibliographyCollection: IProjectBibliographyCollectionStore;
  config?: IntegrationConfig;
}
