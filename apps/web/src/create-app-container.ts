/**
 * Full composition root (lazy-loaded via ensureContainer).
 *
 * Knows about concrete implementations and wires them to AppContainer facades.
 * Heavy optional graphs (integrations, AI executors, collab) load via dynamic import.
 */

import {
  AddLogEntryUseCase,
  AddPaperUseCase,
  ImportPaperUseCase,
  AddRelationUseCase,
  CheckCitationAlertsUseCase,
  LinkCitationsUseCase,
  ManageReadingListUseCase,
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
  appendPaperNote,
  AiProposalExecutorRegistry,
} from "@thesis/core";
import { ArxivMetadataSource } from "@/features/papers/infrastructure/arxiv-metadata-source";
import { CrossrefMetadataSource } from "@/features/papers/infrastructure/crossref-metadata-source";
import { UrlMetadataSource } from "@/features/papers/infrastructure/url-metadata-source";
import { DeletePaperUseCase } from "@/features/papers/application/delete-paper.use-case";
import { LoadPapersScreenUseCase } from "@/features/papers/application/load-papers-screen.use-case";
import { LoadExperimentsScreenUseCase } from "@/features/experiments/application/load-experiments-screen.use-case";
import { LoadVaultScreenUseCase } from "@/features/vault/application/load-vault-screen.use-case";
import { LoadReportScreenUseCase } from "@/features/report/application/load-report-screen.use-case";
import { LoadPlanScreenUseCase } from "@/features/plan/application/load-plan-screen.use-case";
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
  WorkspaceFacade,
  CollabFacade,
  type AppContainer,
} from "@/container/facades";
import type { ProjectContext } from "@/lib/project-context";
import { systemClock, uuidIds } from "@/features/papers/infrastructure/system";
import {
  configureProjectCacheHooks,
  ProjectLwwInvalidator,
  setActiveProjectIdForCache,
} from "@/lib/project-lww-invalidator";
import { registerSessionReset } from "@/lib/clear-session-caches";
import { PassthroughBlobStore } from "@/storage/passthrough-blob-store";
import { PaperImageStore } from "@/features/papers/infrastructure/paper-image-store";
import { VaultAssetStore } from "@/features/vault/infrastructure/vault-asset-store";
import { ReportImageStore } from "@/features/report/infrastructure/report-image-store";
import { createCredentialReader } from "@/integrations/credentials";
import { WorkspaceSearch } from "@/features/search/application/workspace-search";
import { clearActiveProvider } from "@/features/ai-assistant/application/ai-provider-session";
import { closeFolder } from "@/features/workspace/application/workspace-folder";

export interface CreatedAppContainer {
  container: AppContainer;
  projectLww: ProjectLwwInvalidator;
}

export async function createAppContainer(): Promise<CreatedAppContainer> {
  const [
    { wireIntegrations },
    { wireCitationSources },
    { GENERATED_MCP_PROPOSAL_EXECUTOR_FACTORY, GENERATED_MCP_TOOL_NAMES },
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
  const projectLww = new ProjectLwwInvalidator();
  setActiveProjectIdForCache(pid);
  configureProjectCacheHooks({
    onWrite: (resourceType) => projectLww.notifyPeers(resourceType),
    register: (cache) => projectLww.registerCache(cache),
  });
  const backend = wireBackend(readBackendConfig(), projectContext, pid);
  if ("db" in backend) {
    projectLww.watch(backend.db, pid());
  }

  registerSessionReset(() => {
    projectContext.projectId = null;
    // The API key lives only in memory, but "only in memory" has to include
    // "not across a sign-out" — the next person at this browser is not the one
    // who typed it.
    clearActiveProvider();
    closeFolder();
  });

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
  const encryptedBlobStore = new PassthroughBlobStore(backend.rawBlobStore);

  const aiProposalStore = new SupabaseAiProposalStore(backend.db, backend.session, pid);
  const aiAuditStore = new SupabaseAiAuditStore(backend.db, backend.session, pid);

  const paperImageStore = new PaperImageStore(encryptedBlobStore, backend.session);
  const vaultAssetStore = new VaultAssetStore(encryptedBlobStore, backend.session);
  const reportImageStore = new ReportImageStore(encryptedBlobStore, backend.session);

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

  const addPaper = new AddPaperUseCase({
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

  const resolver = new MetadataResolver([
    new ArxivMetadataSource(undefined, "/api/arxiv"),
    new CrossrefMetadataSource(),
    ...(wiredIntegrations.bibliographyMetadataSource
      ? [wiredIntegrations.bibliographyMetadataSource]
      : []),
    new UrlMetadataSource(),
  ]);
  const importPaper = new ImportPaperUseCase(resolver, addPaper);

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

  const addRelation = new AddRelationUseCase({
    repository: backend.paperRelationRepository,
    clock: systemClock,
    ids: uuidIds,
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
      randomBytes: async (n) => {
        const bytes = new Uint8Array(n);
        crypto.getRandomValues(bytes);
        return bytes;
      },
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
  const aiPaperNotes = {
    async appendPaperNote({
      paperId,
      addition,
      expectedRevision,
    }: {
      paperId: string;
      addition: string;
      expectedRevision?: string;
    }) {
      const paper = await paperRepository.getById(paperId);
      if (!paper || (expectedRevision && paper.updatedAt !== expectedRevision)) return "conflicted" as const;
      await paperRepository.save({
        ...paper,
        summary: appendPaperNote(paper.summary, addition),
        updatedAt: systemClock.nowIso(),
      });
      return "appended" as const;
    },
  };
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
          pushZotero: async (paper) => {
            if (paper.metadata?.zoteroKey) return;
            const key = await bibliography.pushPaper(paper);
            if (key)
              await paperRepository.save({
                ...paper,
                metadata: { ...paper.metadata, zoteroKey: key },
              });
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
    listPapers: () => paperRepository.listSummaries?.() ?? paperRepository.list(),
    listLogEntries: () => logEntryRepository.list(),
    listReportSections: () => reportSectionRepository.list(),
    listReadingLists: () => readingListRepository.list(),
    getRelationGraph: () => backend.paperRelationRepository.getGraph(),
    listExperiments: () => experimentRepository.list(),
    listMilestones: () => (pid() ? milestoneRepository.list() : Promise.resolve([])),
    listVaultPages: () => vaultPageRepository.listSummaries?.() ?? vaultPageRepository.list(),
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
  });

  const container: AppContainer = {
    integrations: { bibliography, notifications, logSync, gitRead },
    backendConfig: backend.config,
    papers: new PapersFacade({
      load: loadPapersScreen,
      deletePaper,
      bibliography,
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
      // Read at call time, not at wiring time: the key is only decryptable
      // once the user has unlocked, which is after the container is built.
      zoteroCredentials: async () => {
        const read = createCredentialReader(backend.manageSettings);
        const apiKey = await read("zotero", "apiKey");
        const library = await read("zotero", "library");
        return { ...(apiKey ? { apiKey } : {}), ...(library ? { library } : {}) };
      },
      paperFields: managePaperFields,
      reportSections: reportSectionRepository,
    }),
    graph: new GraphFacade({
      papers: paperRepository,
      notes: vaultPageRepository,
      sections: reportSectionRepository,
      relations: backend.paperRelationRepository,
      lists: readingListRepository,
      listItems: readingListItemRepository,
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
      allowedTools: GENERATED_MCP_TOOL_NAMES.length
        ? (GENERATED_MCP_TOOL_NAMES as readonly import("@thesis/core").AiToolName[])
        : undefined,
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
    readingLists: new ReadingListsFacade({
      load: loadReadingListsScreen,
      lists: readingListRepository,
      listItems: readingListItemRepository,
      manageReadingList,
    }),
    workspace,
    search: new WorkspaceSearch({
      snapshot: () => workspace.snapshot(),
      projectId: pid,
      loadSettings: async () => (await backend.manageSettings.get()).search,
    }),
    prefetchProject,
    integrationConfig: wiredIntegrations.config,
  };

  return { container, projectLww };
}
