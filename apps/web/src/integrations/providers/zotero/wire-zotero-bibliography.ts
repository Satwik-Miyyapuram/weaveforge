import type {
  AddPaperUseCase,
  IMetadataSource,
  IPaperRepository,
  IProjectBibliographyCollectionStore,
  ISettingsRepository,
  ManageSettingsUseCase,
  ManageTagsUseCase,
} from "@thesis/core";
import { ZoteroMetadataSource } from "@/features/papers/infrastructure/zotero-metadata-source";
import { ZoteroExporter } from "@/features/papers/infrastructure/zotero-exporter";
import { ZoteroSync } from "@/features/papers/infrastructure/zotero-sync";
import { ZoteroAnnotations } from "@/features/papers/infrastructure/zotero-annotations";
import type { ProjectContext } from "@/lib/project-context";
import { createCredentialReader } from "../../credentials";
import { ZoteroBibliographyIntegration } from "./bibliography-integration";

export interface ZoteroBibliographyWireResult {
  integration: ZoteroBibliographyIntegration;
  metadataSource: IMetadataSource;
  projectCollection: IProjectBibliographyCollectionStore;
}

/** Wire the Zotero bibliography stack (sync, export, annotations, metadata import). */
export function wireZoteroBibliography(deps: {
  manageSettings: ManageSettingsUseCase;
  settingsRepository: ISettingsRepository;
  projectContext: ProjectContext;
  paperRepository: IPaperRepository;
  manageTags: ManageTagsUseCase;
  addPaper: AddPaperUseCase;
  projectCollection: IProjectBibliographyCollectionStore;
}): ZoteroBibliographyWireResult {
  const projectCollection = deps.projectCollection;
  const readCred = createCredentialReader(deps.manageSettings);

  const credentials = async () => {
    const apiKey = await readCred("zotero", "apiKey");
    const library = await readCred("zotero", "library");
    let collection: string | undefined;
    const pid = deps.projectContext.projectId;
    if (pid) {
      try {
        collection = await projectCollection.getCollection(pid);
      } catch {
        /* ignore */
      }
    }
    return { apiKey, library, collection };
  };

  const integration = new ZoteroBibliographyIntegration({
    librarySync: new ZoteroSync({
      credentials,
      listPapers: () => deps.paperRepository.list(),
      addPaper: (input) => deps.addPaper.addManual(input),
      savePaper: (paper) => deps.paperRepository.save(paper),
      deletePaper: (id) => deps.paperRepository.delete(id),
      onItemTags: async (paper, remote) => {
        const names = (remote.tags ?? []).map((t) => t.tag ?? "").filter(Boolean);
        if (names.length) {
          await deps.manageTags.reconcileSources(
            paper.id,
            names.map((name) => ({ name, source: "zotero_item" as const })),
            ["zotero_item"],
          );
        }
      },
    }),
    exporter: new ZoteroExporter(credentials),
    annotations: new ZoteroAnnotations(credentials),
    papers: deps.paperRepository,
    tags: deps.manageTags,
    settings: deps.settingsRepository,
  });

  return {
    integration,
    metadataSource: new ZoteroMetadataSource(credentials),
    projectCollection,
  };
}
