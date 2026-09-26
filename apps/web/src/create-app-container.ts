/**
 * Full composition root (lazy-loaded via ensureContainer).
 *
 * Knows about concrete implementations and wires them to AppContainer facades.
 * Heavy optional graphs (integrations, AI executors, collab) load via dynamic import.
 */

import {
  AddLogEntryUseCase,
  ImportPaperUseCase,
  AddRelationUseCase,
  CheckCitationAlertsUseCase,
  LinkCitationsUseCase,
  ManageReadingListUseCase,
  ScreenItemsUseCase,
  ManageReportSectionUseCase,
  ManageVaultPageUseCase,
  ManageProjectUseCase,
  ManageExperimentUseCase,
  ManageMilestoneUseCase,
  ManageSharingUseCase,
  ManageCommentsUseCase,
  CreateShareLinkUseCase,
  RedeemShareLinkUseCase,
  ManageShareLinksUseCase,
  RevokeShareLinkUseCase,
  CreateMemberUseCase,
  PinSharedResourceUseCase,
  DuplicateSharedPaperUseCase,
  MetadataResolver,
  ManageTagsUseCase,
  ManagePaperFieldsUseCase,
  UpdatePaperUseCase,
  RemoveRelationUseCase,
  CompactCrdtLogUseCase,
  AppendPaperNoteUseCase,
  PushPaperToZoteroUseCase,
  AiProposalExecutorRegistry,
} from "@weaveforge/core";
import type { AiToolName } from "@weaveforge/core";
import { SemanticScholarMetadataSource } from "@/features/papers/infrastructure/semantic-scholar-metadata-source";
import { OpenAlexMetadataSource } from "@/features/papers/infrastructure/openalex-metadata-source";
import { ReferenceLookupService } from "@/features/reader/application/reference-lookup";
import { createReferenceActions } from "@/features/reader/application/reference-actions";
import { IdbReferenceLookupCache } from "@/features/reader/infrastructure/reference-lookup-cache";
import { ArxivMetadataSource } from "@/features/papers/infrastructure/arxiv-metadata-source";
import { CrossrefMetadataSource } from "@/features/papers/infrastructure/crossref-metadata-source";
import { UrlMetadataSource } from "@/features/papers/infrastructure/url-metadata-source";
import { DeletePaperUseCase } from "@/features/papers/application/delete-paper.use-case";
import { ImportLocalZoteroUseCase } from "@/features/papers/application/import-local-zotero.use-case";
// Adding a paper also asks for its PDF, so a paper imported after the folder
// was adopted reaches `papers/pdf/` without a restart (explorer plan §8).
import { PrefetchingAddPaperUseCase } from "@/features/papers/application/prefetch-paper-pdf.use-case";
import { LoadPapersScreenUseCase } from "@/features/papers/application/load-papers-screen.use-case";
import { LoadExperimentsScreenUseCase } from "@/features/experiments/application/load-experiments-screen.use-case";
import { LoadVaultScreenUseCase } from "@/features/vault/application/load-vault-screen.use-case";
import { LoadReportScreenUseCase } from "@/features/report/application/load-report-screen.use-case";
import { LoadPlanScreenUseCase } from "@/features/plan/application/load-plan-screen.use-case";
import { PlanFeedLinks } from "@/features/plan/infrastructure/plan-feed-links";
import { LoadReadingListsScreenUseCase } from "@/features/reading-lists/application/load-reading-lists-screen.use-case";
import { DuplicateSharedVaultPageUseCase } from "@/features/library/application/duplicate-shared-vault.use-case";
import { LoadSharedWithMeScreenUseCase } from "@/features/sharing/application/load-shared-with-me-screen.use-case";
import { SupabaseShareLinkRepository } from "@/features/sharing/infrastructure/supabase-share-link-repository";
import { WebCryptoShareLinkTokenHasher } from "@/features/sharing/infrastructure/web-crypto-token-hasher";
import { HttpAccountProvisioner } from "@/features/org/infrastructure/http-account-provisioner";
import { PrefetchProjectUseCase } from "@/application/prefetch-project.use-case";
import { wireBackend } from "@/backend/wire-backend";
import { readBackendConfig } from "@/backend/config";
import {
  PapersFacade,
  PaperFieldsFacade,
  ZoteroFacade,
  GraphFacade,
  PlanFacade,
  LogbookFacade,
  ReportFacade,
  VaultFacade,
  ExperimentsFacade,
  DashboardFacade,
  SettingsFacade,
  AiAssistantFacade,
  AiProposalFacade,
  OrgFacade,
  SharingFacade,
  ProjectsFacade,
  AuthFacade,
  SyncFacade,
  ReadingListsFacade,
  ReaderReferencesFacade,
  WorkspaceFacade,
  CollabFacade,
  InkFacade,
  type AppContainer,
} from "@/container/facades";
import { BlobInkChunkStore } from "@/features/ink/infrastructure/blob-ink-chunk-store";
import { FsInkChunkStore } from "@/features/ink/infrastructure/fs-ink-chunk-store";
import { RoutedInkChunkStore } from "@/features/ink/infrastructure/routed-ink-chunk-store";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";
import type { ProjectContext } from "@/lib/project-context";
import { randomBytes, systemClock, uuidIds } from "@/lib/system";
import type { ProjectLwwInvalidator } from "@/lib/cache/project-lww-invalidator";
import { createContainerLifecycle } from "@/container/lifecycle";
import { createLibraryTidy } from "@/container/library-tidy";
import { FetchingBlobStore } from "@/storage/fetching-blob-store";
import { PaperImageStore } from "@/features/papers/infrastructure/paper-image-store";
import { VaultAssetStore } from "@/features/vault/infrastructure/vault-asset-store";
import { ReportImageStore } from "@/features/report/infrastructure/report-image-store";
import { ExperimentArtifactStore } from "@/features/experiments/infrastructure/experiment-artifact-store";
import { createCredentialReader } from "@/integrations/credentials";
import { WorkspaceSearch } from "@/features/search/application/workspace-search";
import { clearActiveProvider } from "@/features/ai-assistant/application/ai-provider-session";
import { closeFolder } from "@/features/workspace/application/workspace-folder";

export interface CreatedAppContainer {
  container: AppContainer;
  projectLww: ProjectLwwInvalidator;
  /**
   * Release everything this container registered.
   *
   * `bootstrap.ts` builds a container per configuration, and the previous one is
   * replaced the moment the backend or storage provider changes. Without this,
   * each generation left behind: two dozen repository-cache registrations, its
   * session-reset hook (so a later sign-out ran every generation's), and a
   * joined private realtime channel.
   */
  dispose: () => void;
}

export async function createAppContainer(): Promise<CreatedAppContainer> {
  const [
    { wireIntegrations },
    { wireCitationSources },
    { GENERATED_MCP_ENABLED, GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY, GENERATED_MCP_TOOL_NAMES },
    { SupabaseAiAuditStore, SupabaseAiProposalStore },
    { SupabaseCrdtUpdateStore },
    { CrdtSnapshotStore },
  ] = await Promise.all([
    import("@/integrations/wire-integrations"),
    import("@/integrations/wire-citations"),
    import("@/deployment/generated-registry"),
    import("@/features/ai-assistant/infrastructure/supabase-ai-proposal-store"),
    import("@/features/collab/infrastructure/supabase-crdt-update-store"),
    import("@/features/collab/infrastructure/crdt-snapshot-store"),
  ]);

  const projectContext: ProjectContext = { projectId: null };
  const pid = () => projectContext.projectId;
  const lifecycle = createContainerLifecycle(projectContext, pid);
  const projectLww = lifecycle.projectLww;
  // Assigned below, once the container exists. Every repository write routes
  // through this hook, and the search index has to hear about them or an edit
  // stays invisible to search until the next reload.
  let search: WorkspaceSearch | null = null;
  // Before `wireBackend`: wiring is what registers the repository caches, and
  // registering them is what collects the disposers.
  lifecycle.installHooks((resourceType) => {
    projectLww.notifyPeers(resourceType);
    search?.markStale(resourceType);
  });
  const backend = wireBackend(readBackendConfig(), projectContext, pid);
  if ("db" in backend) {
    projectLww.watch(backend.db, pid());
  }

  const crdtUpdateStore = new SupabaseCrdtUpdateStore(backend.db);
  const crdtSnapshotStore = new CrdtSnapshotStore(backend.db);
  const compactCrdtLog = new CompactCrdtLogUseCase({ crdtStore: crdtUpdateStore });

  const vaultPageRepository = backend.rawVaultPageRepository;
  const paperRepository = backend.paperRepository;
  const logEntryRepository = backend.logEntryRepository;
  const reportSectionRepository = backend.reportSectionRepository;
  const experimentRepository = backend.experimentRepository;
  const milestoneRepository = backend.milestoneRepository;
  const readingListRepository = backend.readingListRepository;
  const readingListItemRepository = backend.readingListItemRepository;
  const commentRepository = backend.commentRepository;
  const encryptedBlobStore = new FetchingBlobStore(backend.rawBlobStore);

  const aiProposalStore = new SupabaseAiProposalStore(backend.db, backend.session, pid);
  const aiAuditStore = new SupabaseAiAuditStore(backend.db, backend.session, pid);

  const paperImageStore = new PaperImageStore(encryptedBlobStore, backend.session);
  const vaultAssetStore = new VaultAssetStore(encryptedBlobStore, backend.session);
  const reportImageStore = new ReportImageStore(encryptedBlobStore, backend.session);
  // Signs artifact paths on read. Nothing stores a signed URL: SigV4 caps one
  // at seven days, so a stored link is a link with a deadline.
  const experimentArtifactStore = new ExperimentArtifactStore(encryptedBlobStore, backend.session);
  // Ink chunks follow the page: the folder's `.ink/` when one is open, the
  // encrypted asset bucket otherwise (§4.1). Routed per call, since a folder
  // can be chosen or forgotten while the app is running.
  const fsInkChunks = new FsInkChunkStore(activeWorkspaceFs);
  const blobInkChunks = new BlobInkChunkStore(encryptedBlobStore, backend.session);
  const inkChunkStore = new RoutedInkChunkStore(() => (activeWorkspaceFs() ? fsInkChunks : blobInkChunks));

  const manageProject = new ManageProjectUseCase({
    repository: backend.projectRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const manageTags = new ManageTagsUseCase({
    tags: backend.tagRepository,
    paperTags: backend.paperTagRepository,
    papers: paperRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const addPaper = new PrefetchingAddPaperUseCase({
    repository: paperRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const updatePaper = new UpdatePaperUseCase({
    repository: paperRepository,
    tags: manageTags,
    clock: systemClock,
  });

  const projectBibliographyCollection = backend.projectBibliographyCollection;

  const wiredIntegrations = wireIntegrations({
    projectContext,
    integrationsStore: backend.integrationsStore,
    manageSettings: backend.manageSettings,
    settingsRepository: backend.settingsRepository,
    paperRepository: paperRepository,
    manageTags,
    addPaper,
    projectBibliographyCollection,
  });
  const { bibliography, notifications, logSync, gitRead } = wiredIntegrations.registry;

  // The key is read at call time: it is only decryptable after unlock.
  const semanticScholarSource = new SemanticScholarMetadataSource(undefined, undefined, () =>
    createCredentialReader(backend.manageSettings)("semantic-scholar", "apiKey"),
  );
  const openAlexSource = new OpenAlexMetadataSource();

  const resolver = new MetadataResolver([
    new ArxivMetadataSource(undefined, "/api/arxiv"),
    new CrossrefMetadataSource(),
    ...(wiredIntegrations.bibliographyMetadataSource
      ? [wiredIntegrations.bibliographyMetadataSource]
      : []),
    // Title-only lookups for the reader's citation popover. Semantic Scholar
    // first (its match endpoint is built for this), OpenAlex as the fallback.
    semanticScholarSource,
    openAlexSource,
    new UrlMetadataSource(),
  ]);
  const importPaper = new ImportPaperUseCase(resolver, addPaper);

  // The reader's citation lookup: Semantic Scholar is the first provider for
  // DOI, arXiv and title+author+year alike, with OpenAlex/Crossref behind it.
  // Desktop requests reach the API through #242's relay (see
  // `semanticScholarUrl`), not a second direct network path. Identifier refs
  // cascade so a DOI Semantic Scholar does not know still lands in Crossref.
  const readerResolver = new MetadataResolver(
    [semanticScholarSource, openAlexSource, new CrossrefMetadataSource(), new ArxivMetadataSource(undefined, "/api/arxiv")],
    true,
  );

  const addLogEntry = new AddLogEntryUseCase({
    repository: logEntryRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const manageReportSection = new ManageReportSectionUseCase({
    repository: reportSectionRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const manageVaultPage = new ManageVaultPageUseCase({
    repository: vaultPageRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const manageReadingList = new ManageReadingListUseCase({
    lists: readingListRepository,
    items: readingListItemRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const screenItems = new ScreenItemsUseCase({
    screening: backend.screeningRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const addRelation = new AddRelationUseCase({
    repository: backend.paperRelationRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const readerReferences = new ReaderReferencesFacade({
    lookup: new ReferenceLookupService(readerResolver, paperRepository, new IdbReferenceLookupCache()),
    actions: createReferenceActions({
      importPaper,
      addPaper,
      relations: addRelation,
    }),
  });
  const citationSources = wireCitationSources({
    manageSettings: backend.manageSettings,
    config: wiredIntegrations.config,
  });
  const linkCitations = new LinkCitationsUseCase(
    citationSources,
    paperRepository,
    backend.paperRelationRepository,
    addRelation,
  );
  const citationAlerts = new CheckCitationAlertsUseCase({
    papers: paperRepository,
    tracks: backend.citationAlertTrackRepository,
    sources: citationSources,
    logs: addLogEntry,
    notifications,
    clock: systemClock,
    getProjectId: pid,
  });

  const managePaperFields = new ManagePaperFieldsUseCase({
    fields: backend.paperFieldRepository,
    ids: uuidIds,
  });

  const manageExperiment = new ManageExperimentUseCase({
    repository: experimentRepository,
    clock: systemClock,
    ids: uuidIds,
  });

  const manageSharing = new ManageSharingUseCase({ repository: backend.shareRepository });
  const manageComments = new ManageCommentsUseCase({ repository: commentRepository });
  const shareLinkTokenHasher = new WebCryptoShareLinkTokenHasher();
  const shareLinkRepository =
    "db" in backend ? new SupabaseShareLinkRepository(backend.db) : null;
  const createShareLink =
    shareLinkRepository &&
    new CreateShareLinkUseCase({
      shareLinks: shareLinkRepository,
      tokenHasher: shareLinkTokenHasher,
      ids: uuidIds,
      clock: systemClock,
      randomBytes,
    });
  const redeemShareLink =
    shareLinkRepository &&
    new RedeemShareLinkUseCase({
      shareLinks: shareLinkRepository,
      tokenHasher: shareLinkTokenHasher,
    });
  const manageShareLinks =
    shareLinkRepository && new ManageShareLinksUseCase({ shareLinks: shareLinkRepository });
  const revokeShareLink =
    shareLinkRepository &&
    new RevokeShareLinkUseCase({
      shareLinks: shareLinkRepository,
    });
  const pinSharedResource = new PinSharedResourceUseCase({
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const duplicateSharedPaper = new DuplicateSharedPaperUseCase({
    shares: backend.shareRepository,
    papers: paperRepository,
    addPaper,
  });
  const duplicateSharedVaultPage = new DuplicateSharedVaultPageUseCase({
    shares: backend.shareRepository,
    pages: vaultPageRepository,
    manageVaultPage,
    assets: vaultAssetStore,
  });

  const manageMilestone = new ManageMilestoneUseCase({
    repository: milestoneRepository,
    clock: systemClock,
    ids: uuidIds,
  });
  // Was an object literal here; it was the only place that decided whether an
  // approved note proposal still applies, and it could not be tested without
  // wiring the whole container. The port it satisfies already existed in core.
  const aiPaperNotes = new AppendPaperNoteUseCase({
    papers: paperRepository,
    clock: systemClock,
  });
  // One push rule, shared with `PapersFacade.autoPush`: it used to be written out
  // in both places, and the copies disagreed about what a failed push means.
  const pushToZotero = new PushPaperToZoteroUseCase({
    papers: paperRepository,
    bibliography,
  });
  const importLocalZotero = new ImportLocalZoteroUseCase({
    papers: paperRepository,
    addPaper,
    manageTags,
    // Lazily, because the desktop bridge is only meaningful inside the shell.
    bridge: async () => (await import("@/lib/desktop/desktop-bridge")).desktop(),
    // The same per-project collection the cloud sync reads, so "read Zotero on
    // this computer" takes the collection the reader is working on rather than
    // their whole library. `undefined` — no project, or none chosen — means the
    // whole library, which is what the cloud path does too.
    collection: async () => {
      const projectId = pid();
      if (!projectId) return undefined;
      try {
        return await projectBibliographyCollection.getCollection(projectId);
      } catch {
        // A collection setting that cannot be read is not a reason to refuse
        // the import: the whole library is a superset of it, and a reader gets
        // their papers rather than an error about a setting.
        return undefined;
      }
    },
  });
  const aiProposalExecutors = new AiProposalExecutorRegistry(
    GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY
      ? GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY({
          paperNotes: aiPaperNotes,
          vault: manageVaultPage,
          logs: addLogEntry,
          papers: paperRepository,
          updatePaper,
          paperFields: managePaperFields,
          addPaper,
          // The outcome is dropped on purpose. This executor's contract is
          // accepted-or-conflicted, and a Zotero push that failed is neither: the
          // paper *was* added, so "conflicted" would be a lie and a throw would
          // report failure for a write that landed. A failed push is survivable —
          // the paper simply has no item behind it — and the outcome is there for
          // a caller that wants to say so.
          pushZotero: async (paper) => {
            await pushToZotero.execute(paper);
          },
          lists: manageReadingList,
          relations: addRelation,
          milestones: manageMilestone,
          experiments: manageExperiment,
        })
      : [],
  );

  const createMember = new CreateMemberUseCase({
    members: backend.memberRepository,
    provisioner: new HttpAccountProvisioner(backend.auth),
  });

  const prefetchProject = new PrefetchProjectUseCase({
    listPapers: () => paperRepository.listSummaries(),
    listLogEntries: () => logEntryRepository.list(),
    listReportSections: () => reportSectionRepository.list(),
    listReadingLists: () => readingListRepository.list(),
    getRelationGraph: () => backend.paperRelationRepository.getGraph(),
    listExperiments: () => experimentRepository.list(),
    listMilestones: () => (pid() ? milestoneRepository.list() : Promise.resolve([])),
    listVaultPages: () => vaultPageRepository.listSummaries(),
    listTags: () => backend.tagRepository.listWithCounts(),
    listPins: () => backend.libraryPinRepository.listForProject(),
  });

  const deletePaper = new DeletePaperUseCase({
    bibliography,
    images: paperImageStore,
    updatePaper,
    papers: paperRepository,
  });
  const loadPapersScreen = new LoadPapersScreenUseCase({
    papers: paperRepository,
    lists: readingListRepository,
    listItems: readingListItemRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const loadExperimentsScreen = new LoadExperimentsScreenUseCase({
    experiments: experimentRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const loadVaultScreen = new LoadVaultScreenUseCase({
    pages: vaultPageRepository,
    lists: readingListRepository,
    listItems: readingListItemRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const loadReportScreen = new LoadReportScreenUseCase({
    sections: reportSectionRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const loadPlanScreen = new LoadPlanScreenUseCase({
    milestones: milestoneRepository,
    papers: paperRepository,
    experiments: experimentRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const loadReadingListsScreen = new LoadReadingListsScreenUseCase({
    lists: readingListRepository,
    papers: paperRepository,
    notes: vaultPageRepository,
    pins: backend.libraryPinRepository,
    shares: backend.shareRepository,
  });
  const removeRelation = new RemoveRelationUseCase(backend.paperRelationRepository);

  const loadSharedWithMeScreen = new LoadSharedWithMeScreenUseCase({
    sharing: manageSharing,
    sharedReader: backend.sharedReader,
    members: backend.memberRepository,
    papers: paperRepository,
    experiments: experimentRepository,
    vaultPages: vaultPageRepository,
    readingLists: readingListRepository,
  });

  // Repositories, not facades: the screen facades return card projections that
  // drop note bodies, paper abstracts, and paper metadata.
  const workspace = new WorkspaceFacade({
    papers: paperRepository,
    vaultPages: vaultPageRepository,
    readingLists: readingListRepository,
    readingListItems: readingListItemRepository,
    reportSections: reportSectionRepository,
    experiments: experimentRepository,
    milestones: milestoneRepository,
    logEntries: logEntryRepository,
    relations: backend.paperRelationRepository,
    tags: backend.tagRepository,
    // Reader highlights: `list` is per-paper, so the index needs the
    // project-wide read that carries the paper and page on each row.
    readerAnnotations: { list: () => backend.readerAnnotationRepository.listForProject() },
    projectId: pid,
  });

  // Registered once `workspace` exists: it closes over the facade, and
  // registering it near the top of this function was a `const` used above its
  // own declaration. The lifecycle holds the disposer, so a container that is
  // replaced takes its hook with it.
  lifecycle.registerReset(() => {
    projectContext.projectId = null;
    workspace.resetSnapshotBaseline();
    // The search index is a copy of the previous user's workspace — note titles,
    // note bodies, paper abstracts — held in memory for the life of the tab. The
    // container is not torn down on sign-out and the index has no owner check, so
    // without this the next person at this browser can rank-search the last
    // person's notes until something happens to rebuild it. Dropping it here
    // costs one rebuild on the next sign-in.
    search?.invalidate();
    // The API key lives only in memory, but "only in memory" has to include
    // "not across a sign-out" — the next person at this browser is not the one
    // who typed it.
    clearActiveProvider();
    closeFolder();
    // Leave the project's realtime channel. The reset nulls the project id but
    // nothing told the invalidator, so the private channel for the previous
    // project stayed joined until the next `watch()` — which, for a session
    // that ends here, never came.
    projectLww.dispose();
  });

  /**
   * The AI tool surface, as the deployment configured it.
   *
   * A tool allowlist may only ever narrow. Two states mean "no tools" — the
   * MCP plugin disabled, and a generated registry that selected nothing — and
   * both used to be passed as `undefined`, which the facade reads as "no
   * allowlist at all" and fills with every core tool. The empty list is passed
   * as an empty list so the surface can only be narrowed by configuration,
   * never widened by its absence.
   */
  const allowedAiTools = (
    GENERATED_MCP_ENABLED ? GENERATED_MCP_TOOL_NAMES : []
  ) as readonly AiToolName[];

  const container: AppContainer = {
    integrations: { bibliography, notifications, logSync, gitRead },
    backendConfig: backend.config,
    papers: new PapersFacade({
      load: loadPapersScreen,
      deletePaper,
      papers: paperRepository,
      manageTags,
      updatePaper,
      importPaper,
      addPaper,
      images: paperImageStore,
      citationAlerts,
      annotationPins: backend.annotationPinRepository,
      annotationQuotationTypes: backend.annotationQuotationTypeRepository,
      readerAnnotations: backend.readerAnnotationRepository,
      reportSections: reportSectionRepository,
    }),
    paperFields: new PaperFieldsFacade({ paperFields: managePaperFields }),
    libraryTidy: createLibraryTidy({ papers: paperRepository, updatePaper, resolver, backend, bibliography, newId: uuidIds.newId }),
    zotero: new ZoteroFacade({
      bibliography,
      pushToZotero,
      importLocalZotero,
      readerAnnotations: backend.readerAnnotationRepository,
      papers: paperRepository,
      manageTags,
      // Read at call time, not at wiring time: the key is only decryptable
      // once the user has unlocked, which is after the container is built.
      zoteroCredentials: async () => {
        const read = createCredentialReader(backend.manageSettings);
        const apiKey = await read("zotero", "apiKey");
        const library = await read("zotero", "library");
        return { ...(apiKey ? { apiKey } : {}), ...(library ? { library } : {}) };
      },
    }),
    graph: new GraphFacade({
      papers: paperRepository,
      notes: vaultPageRepository,
      sections: reportSectionRepository,
      relations: backend.paperRelationRepository,
      lists: readingListRepository,
      listItems: readingListItemRepository,
      experiments: experimentRepository,
      addRelation,
      linkCitations,
      removeRelation,
      manageTags,
      tags: backend.tagRepository,
      settings: backend.graphSettingsRepository,
    }),
    plan: new PlanFacade({
      load: loadPlanScreen,
      milestones: milestoneRepository,
      manageMilestone,
      notifications,
      feedLinks: new PlanFeedLinks(backend.db, backend.session),
    }),
    logbook: new LogbookFacade({
      logEntries: logEntryRepository,
      addLogEntry,
      logSync,
    }),
    report: new ReportFacade({
      load: loadReportScreen,
      sections: reportSectionRepository,
      manageReportSection,
      images: reportImageStore,
    }),
    ink: new InkFacade({
      chunks: inkChunkStore,
      assets: vaultAssetStore,
      bridge: desktop,
      vocabulary: async () => {
        const [pages, papers] = await Promise.all([
          // Titles only — the projection is the right read, now that the port
          // requires it rather than leaving each caller a fallback to write.
          vaultPageRepository.listSummaries(),
          paperRepository.listSummaries(),
        ]);
        return [pages.map((page) => page.title), papers.map((paper) => paper.title)];
      },
    }),
    vault: new VaultFacade({
      load: loadVaultScreen,
      pages: vaultPageRepository,
      manageVaultPage,
      assets: vaultAssetStore,
      duplicateSharedPage: duplicateSharedVaultPage,
    }),
    collab: new CollabFacade({
      crdtStore: crdtUpdateStore,
      crdtSnapshotStore,
      compactCrdtLog,
      db: backend.db,
      session: backend.session,
      projectId: pid,
    }),
    experiments: new ExperimentsFacade({
      load: loadExperimentsScreen,
      experiments: experimentRepository,
      papers: paperRepository,
      metrics: backend.metricRepository,
      manageExperiment,
      artifacts: experimentArtifactStore,
    }),
    dashboard: new DashboardFacade({
      layout: backend.dashboardLayoutRepository,
      prefetch: prefetchProject,
      projectId: pid,
      papers: paperRepository,
      sections: reportSectionRepository,
      milestones: milestoneRepository,
      experiments: experimentRepository,
      logEntries: logEntryRepository,
      relations: backend.paperRelationRepository,
      lists: readingListRepository,
      tags: backend.tagRepository,
      supervision: backend.supervisionRepository,
    }),
    settings: new SettingsFacade({
      settings: backend.manageSettings,
      bibliography,
      projectBibliography: wiredIntegrations.projectBibliographyCollection,
      integrations: backend.integrationsStore,
    }),
    aiAssistant: new AiAssistantFacade({
      papers: paperRepository,
      vaultPages: vaultPageRepository,
      readingLists: readingListRepository,
      logEntries: logEntryRepository,
      experiments: experimentRepository,
      milestones: milestoneRepository,
      proposals: aiProposalStore,
      isEncryptionUnlocked: () => true,
      newId: () => uuidIds.newId(),
      now: () => systemClock.nowIso(),
      allowedTools: allowedAiTools,
    }),
    aiProposals: new AiProposalFacade({
      proposals: aiProposalStore,
      audit: aiAuditStore,
      executors: aiProposalExecutors,
      newId: () => uuidIds.newId(),
      now: () => systemClock.nowIso(),
    }),
    org: new OrgFacade({
      members: backend.memberRepository,
      createMember,
      supervision: backend.supervisionRepository,
      labSnapshots: backend.labSnapshotRepository,
      milestones: backend.milestoneRepository,
      logs: backend.logEntryRepository,
    }),
    sharing: new SharingFacade({
      sharing: manageSharing,
      comments: manageComments,
      createShareLink: createShareLink ?? null,
      redeemShareLink: redeemShareLink ?? null,
      manageShareLinks: manageShareLinks ?? null,
      revokeShareLink: revokeShareLink ?? null,
      session: backend.session,
      sharedReader: backend.sharedReader,
      members: backend.memberRepository,
      pinShared: pinSharedResource,
      duplicateSharedPaper,
      libraryPins: backend.libraryPinRepository,
      papers: paperRepository,
      experiments: experimentRepository,
      loadSharedWithMe: loadSharedWithMeScreen,
    }),
    projects: new ProjectsFacade({
      projects: backend.projectRepository,
      manageProject,
      context: projectContext,
      watchLww: (id) => {
        if ("db" in backend) projectLww.watch(backend.db, id);
      },
    }),
    auth: new AuthFacade({ auth: backend.auth }),
    sync: new SyncFacade({
      integrations: backend.integrationsStore,
      git: gitRead,
      manageExperiment,
    }),
    readerReferences,
    readingLists: new ReadingListsFacade({
      load: loadReadingListsScreen,
      lists: readingListRepository,
      listItems: readingListItemRepository,
      manageReadingList,
      screenItems,
    }),
    workspace,
    search: (search = new WorkspaceSearch({
      snapshot: () => workspace.snapshot(),
      projectId: pid,
      loadSettings: async () => (await backend.manageSettings.get()).search,
    })),
    prefetchProject,
    integrationConfig: wiredIntegrations.config,
  };

  return { container, projectLww, dispose: lifecycle.dispose };
}
