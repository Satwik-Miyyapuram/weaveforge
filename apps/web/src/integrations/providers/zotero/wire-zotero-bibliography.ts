import type {
  AddPaperUseCase,
  IMetadataSource,
  IPaperRepository,
  IProjectBibliographyCollectionStore,
  ISettingsRepository,
  ManageSettingsUseCase,
  ManageTagsUseCase,
} from "@weaveforge/core";
import { ZoteroMetadataSource } from "@/features/papers/infrastructure/zotero-metadata-source";
import { ZoteroExporter } from "@/features/papers/infrastructure/zotero-exporter";
import { ZoteroSync } from "@/features/papers/infrastructure/zotero-sync";
import { ZoteroAnnotations } from "@/features/papers/infrastructure/zotero-annotations";
import type { ProjectContext } from "@/lib/project-context";
import { isOfflineBuild } from "@/deployment/build-target";
import { createCredentialReader } from "../../credentials";
import { ZoteroBibliographyIntegration } from "./bibliography-integration";

/**
 * How the collection picker should ask Zotero, for this build.
 *
 * The picker is the one Zotero call that goes through a route: on the web a page
 * on a normal origin cannot read `api.zotero.org` because Zotero sends no CORS
 * headers, so `/api/integrations/zotero/collections` relays it. The desktop app
 * has no such route — the export holds `src/app/api/` aside — so it was asking a
 * route that does not exist and reading the 404 as "no collections", which is
 * what told a reader with a perfectly good key to "check the API key and
 * library".
 *
 * The relay is not needed there. `app://weaveforge` is a real secure origin, not
 * an opaque `file://` one, and `api.zotero.org` answers it directly — measured
 * against the installed app, `GET /users/<id>/collections` and `/items/top` both
 * 200, which is also how the rest of the Zotero stack already talks to Zotero
 * (`ZoteroSync`, the exporter, the annotation pull and the metadata source all
 * default to plain `fetch`).
 *
 * `offline` is a parameter so the choice is testable without rebuilding the app;
 * every caller takes the default.
 *
 * The returned function is a **wrapper, not the global itself**, and that is load
 * bearing rather than tidiness. `bibliography-integration.ts` calls it as
 * `this.deps.fetchFn(url, init)`, so the receiver is the deps object; `fetch` is a
 * Window operation that refuses a receiver which is not a Window, throwing
 * `TypeError: Illegal invocation` *before* any request is queued. Passing the raw
 * global therefore reproduced the very symptom this function exists to fix —
 * "Could not read collections" with nothing in the network log — which is why
 * every other `fetchFn` default in `features/papers/infrastructure` is written
 * `(...args) => fetch(...args)` as well (`zotero-sync.ts:34` and five others).
 */
export function zoteroCollectionsFetch(offline: boolean = isOfflineBuild()): typeof fetch | undefined {
  return offline ? (...args: Parameters<typeof fetch>) => fetch(...args) : undefined;
}

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
    // The one call whose transport differs by build; see
    // `zoteroCollectionsFetch`.
    fetchFn: zoteroCollectionsFetch(),
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
