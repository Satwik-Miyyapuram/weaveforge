import type {
  IAdminUserProvisioner,
  IAuthService,
  ICommentRepository,
  ICurrentUserProvider,
  IDashboardLayoutRepository,
  IGraphSettingsRepository,
  IExperimentRepository,
  ILogEntryRepository,
  IMemberRepository,
  IMetricRepository,
  IMilestoneRepository,
  IPaperRelationRepository,
  IPaperRepository,
  IProjectBibliographyCollectionStore,
  IProjectRepository,
  IReadingListItemRepository,
  IReadingListRepository,
  IReportSectionRepository,
  ISettingsRepository,
  IShareRepository,
  ISupervisionRepository,
  ITagRepository,
  IPaperTagRepository,
  IVaultPageRepository,
  ManageSettingsUseCase,
  ILibraryPinRepository,
  ICitationAlertTrackRepository,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  ILabSnapshotRepository,
  IPaperFieldRepository,
  IReaderAnnotationSink,
  IReaderAnnotationProjectSource,
  IReaderAnnotationSource,
  IBlobStore,
} from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ManageSettingsUseCase as ManageSettingsUseCaseClass } from "@weaveforge/core";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import { SupabaseDashboardLayoutRepository } from "@/features/dashboard/infrastructure/supabase-dashboard-layout-repository";
import { SupabaseGraphSettingsRepository } from "@/features/relations/infrastructure/supabase-graph-settings-repository";
import { SupabaseExperimentRepository } from "@/features/experiments/infrastructure/supabase-experiment-repository";
import { SupabaseMetricRepository } from "@/features/experiments/infrastructure/supabase-metric-repository";
import { SupabaseLogEntryRepository } from "@/features/logbook/infrastructure/supabase-log-entry-repository";
import { SupabaseMemberRepository } from "@/features/org/infrastructure/supabase-member-repository";
import { SupabaseSupervisionRepository } from "@/features/org/infrastructure/supabase-supervision-repository";
import { SupabasePaperRepository } from "@/features/papers/infrastructure/supabase-paper-repository";
import { SupabaseMilestoneRepository } from "@/features/plan/infrastructure/supabase-milestone-repository";
import { SupabaseProjectRepository } from "@/features/projects/infrastructure/supabase-project-repository";
import { ProjectZoteroStore } from "@/features/projects/infrastructure/project-zotero-store";
import {
  SupabaseReadingListRepository,
  SupabaseReadingListItemRepository,
} from "@/features/reading-lists/infrastructure/supabase-reading-list-repository";
import { SupabasePaperRelationRepository } from "@/features/relations/infrastructure/supabase-paper-relation-repository";
import { SupabaseCitationAlertTrackRepository } from "@/features/relations/infrastructure/supabase-citation-alert-track-repository";
import { SupabaseAnnotationPinRepository } from "@/features/papers/infrastructure/supabase-annotation-pin-repository";
import { SupabaseAnnotationQuotationTypeRepository } from "@/features/papers/infrastructure/supabase-annotation-quotation-type-repository";
import { SupabaseLabSnapshotRepository } from "@/features/org/infrastructure/supabase-lab-snapshot-repository";
import { SupabaseReaderAnnotationRepository } from "@/features/reader/infrastructure/supabase-reader-annotation-repository";
import { SupabasePaperFieldRepository } from "@/features/papers/infrastructure/supabase-paper-field-repository";
import { SupabaseReportSectionRepository } from "@/features/report/infrastructure/supabase-report-section-repository";
import { SupabaseVaultPageRepository } from "@/features/vault/infrastructure/supabase-vault-page-repository";
import { SupabaseSettingsRepository } from "@/features/settings/infrastructure/supabase-settings-repository";
import { SupabaseCommentRepository } from "@/features/sharing/infrastructure/supabase-comment-repository";
import { SupabaseShareRepository } from "@/features/sharing/infrastructure/supabase-share-repository";
import { SupabaseSharedReader } from "@/features/sharing/infrastructure/supabase-shared-reader";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import { SupabaseIntegrationsStore } from "@/features/sync/infrastructure/supabase-integrations-store";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { SupabaseTagRepository, SupabasePaperTagRepository } from "@/features/tags";
import { SupabaseLibraryPinRepository } from "@/features/library";
import type { ProjectContext } from "@/lib/project-context";
import { cacheRepo } from "@/lib/cache-repo";
import type { BackendConfig } from "@/backend/config";
import { createSupabaseClient } from "./client";
import { SupabaseSessionProvider } from "./session";
import { SupabaseAdminUserProvisioner } from "./admin-provisioner";
import { wireStorage } from "@/storage/wire-storage";

export interface WiredSupabaseBackend {
  readonly config: BackendConfig;
  readonly db: SupabaseClient;
  readonly session: ICurrentUserProvider;
  readonly auth: IAuthService;
  readonly adminProvisioner: IAdminUserProvisioner | null;
  readonly projectContext: ProjectContext;
  readonly settingsRepository: ISettingsRepository;
  readonly manageSettings: ManageSettingsUseCase;
  readonly projectRepository: IProjectRepository;
  readonly dashboardLayoutRepository: IDashboardLayoutRepository;
  readonly graphSettingsRepository: IGraphSettingsRepository;
  readonly integrationsStore: IIntegrationsStore;
  readonly paperRepository: IPaperRepository;
  readonly tagRepository: ITagRepository;
  readonly paperTagRepository: IPaperTagRepository;
  readonly logEntryRepository: ILogEntryRepository;
  readonly reportSectionRepository: IReportSectionRepository;
  readonly readingListRepository: IReadingListRepository;
  readonly readingListItemRepository: IReadingListItemRepository;
  readonly paperRelationRepository: IPaperRelationRepository;
  readonly experimentRepository: IExperimentRepository;
  readonly metricRepository: IMetricRepository;
  readonly shareRepository: IShareRepository;
  readonly commentRepository: ICommentRepository;
  readonly sharedReader: ISharedReader;
  readonly milestoneRepository: IMilestoneRepository;
  readonly memberRepository: IMemberRepository;
  readonly supervisionRepository: ISupervisionRepository;
  readonly projectBibliographyCollection: IProjectBibliographyCollectionStore;
  readonly rawBlobStore: IBlobStore;
  readonly rawVaultPageRepository: IVaultPageRepository;
  readonly libraryPinRepository: ILibraryPinRepository;
  readonly citationAlertTrackRepository: ICitationAlertTrackRepository;
  readonly annotationPinRepository: IAnnotationPinRepository;
  readonly annotationQuotationTypeRepository: IAnnotationQuotationTypeRepository;
  readonly labSnapshotRepository: ILabSnapshotRepository;
  readonly readerAnnotationRepository: IReaderAnnotationSource &
    IReaderAnnotationSink &
    IReaderAnnotationProjectSource;
  readonly paperFieldRepository: IPaperFieldRepository;
}

export function wireSupabaseBackend(
  config: BackendConfig,
  projectContext: ProjectContext,
  pid: () => string | null,
): WiredSupabaseBackend {
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase backend requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const db = createSupabaseClient(url, anonKey, config.dataUrl);
  const session = new SupabaseSessionProvider(db);
  const auth = new SupabaseAuthService(db);
  const adminProvisioner =
    url && config.supabaseServiceRoleKey
      ? new SupabaseAdminUserProvisioner(url, config.supabaseServiceRoleKey)
      : null;

  const settingsRepository = new SupabaseSettingsRepository(db, session);
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository });
  const projectRepository = cacheRepo(
    new SupabaseProjectRepository(db, session),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "project" },
  );
  const dashboardLayoutRepository = cacheRepo(
    new SupabaseDashboardLayoutRepository(db),
    ["get"],
    ["save"],
    pid,
    { resourceType: "dashboard_layout" },
  );
  const graphSettingsRepository = cacheRepo(
    new SupabaseGraphSettingsRepository(db),
    ["get"],
    ["save"],
    pid,
    { resourceType: "graph_settings" },
  );
  const integrationsStore: IIntegrationsStore = new SupabaseIntegrationsStore(db);
  const paperRepository = cacheRepo(
    new SupabasePaperRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "paper" },
  );

  const tagPaperCache = new Map<string, Promise<unknown>>();
  const tagPaperSettled = new Map<string, unknown>();
  const tagRepository = cacheRepo(
    new SupabaseTagRepository(db, projectContext),
    ["getById", "findByName", "list", "listWithCounts"],
    ["save", "delete"],
    pid,
    { resourceType: "tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );
  const paperTagRepository = cacheRepo(
    new SupabasePaperTagRepository(db),
    ["listForPaper", "listForTag", "listAll"],
    ["link", "unlink", "unlinkBySource", "reconcile"],
    pid,
    { resourceType: "paper_tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );

  const logEntryRepository = cacheRepo(
    new SupabaseLogEntryRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "log_entry" },
  );
  const reportSectionRepository = cacheRepo(
    new SupabaseReportSectionRepository(db, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "report_section" },
  );
  const rawVaultPageRepository = new SupabaseVaultPageRepository(db, projectContext);
  const readingListRepository = cacheRepo(
    new SupabaseReadingListRepository(db, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "reading_list" },
  );
  const readingListItemRepository = cacheRepo(
    new SupabaseReadingListItemRepository(db),
    ["listItems", "listItemsForLists", "listsForPaper", "find"],
    ["add", "remove"],
    pid,
    { resourceType: "reading_list_item" },
  );
  const paperRelationRepository = cacheRepo(
    new SupabasePaperRelationRepository(db, projectContext),
    ["getById", "list", "getGraph", "relationsFor", "findEdge"],
    ["save", "delete"],
    pid,
    { resourceType: "paper_relation" },
  );
  const experimentRepository = cacheRepo(
    new SupabaseExperimentRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "experiment" },
  );
  const metricRepository = new SupabaseMetricRepository(db);
  const shareRepository = cacheRepo(
    new SupabaseShareRepository(db, session),
    ["listForResource", "listSharedWithMe"],
    ["grant", "revoke"],
    pid,
    { resourceType: "share" },
  );
  const commentRepository = new SupabaseCommentRepository(db);
  const sharedReader: ISharedReader = cacheRepo(
    new SupabaseSharedReader(db),
    ["read"],
    [],
    pid,
  );
  const milestoneRepository = cacheRepo(
    new SupabaseMilestoneRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "milestone" },
  );
  // The only repository that was not cached. Its reads hit `profiles`, whose
  // RLS predicate calls the recursive `lab_root` per row — measured at ~1.8s
  // against a real database, dwarfing every other query on a screen load. Five
  // screens await it before rendering, and it was refetched on each of them.
  // Membership does not change during a session, so it caches like the rest.
  const memberRepository = cacheRepo(
    new SupabaseMemberRepository(db, session),
    ["getMine", "listTeam", "listDirectory", "listLab"],
    [],
    pid,
  );
  const supervisionRepository = new SupabaseSupervisionRepository(db);
  const projectBibliographyCollection = new ProjectZoteroStore(db);
  const rawBlobStore = wireStorage({ supabaseDb: db });
  const libraryPinRepository: ILibraryPinRepository = cacheRepo(
    new SupabaseLibraryPinRepository(db, projectContext, session),
    ["listForProject", "isPinned"],
    ["pin", "unpin"],
    pid,
    { resourceType: "library_pin" },
  );
  const citationAlertTrackRepository: ICitationAlertTrackRepository = cacheRepo(
    new SupabaseCitationAlertTrackRepository(db, projectContext, session),
    ["listForProject", "getByPaperId"],
    ["track", "untrack", "save"],
    pid,
    { resourceType: "citation_alert_track" },
  );
  const annotationPinRepository: IAnnotationPinRepository = cacheRepo(
    new SupabaseAnnotationPinRepository(db, projectContext, session),
    ["listForProject", "listForPaper", "listForSection"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const annotationQuotationTypeRepository: IAnnotationQuotationTypeRepository = cacheRepo(
    new SupabaseAnnotationQuotationTypeRepository(db, projectContext, session),
    ["listForPaper"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const labSnapshotRepository: ILabSnapshotRepository = cacheRepo(
    new SupabaseLabSnapshotRepository(db, projectContext, session),
    ["listMine", "listForMember", "getById"],
    ["publish", "remove"],
    pid,
    { resourceType: "project" },
  );
  const readerAnnotationRepository = cacheRepo(
    new SupabaseReaderAnnotationRepository(db, projectContext, session),
    ["list", "listForProject"],
    ["create", "update", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const paperFieldRepository: IPaperFieldRepository = cacheRepo(
    new SupabasePaperFieldRepository(db, projectContext, session),
    ["listDefs", "listValuesForPaper", "listValuesForProject"],
    ["saveDef", "deleteDef", "setValue", "removeValue"],
    pid,
    { resourceType: "paper" },
  );

  return {
    config,
    db,
    session,
    auth,
    adminProvisioner,
    projectContext,
    settingsRepository,
    manageSettings,
    projectRepository,
    dashboardLayoutRepository,
    graphSettingsRepository,
    integrationsStore,
    paperRepository,
    tagRepository,
    paperTagRepository,
    logEntryRepository,
    reportSectionRepository,
    readingListRepository,
    readingListItemRepository,
    paperRelationRepository,
    experimentRepository,
    metricRepository,
    shareRepository,
    commentRepository,
    sharedReader,
    milestoneRepository,
    memberRepository,
    supervisionRepository,
    projectBibliographyCollection,
    rawBlobStore,
    rawVaultPageRepository,
    libraryPinRepository,
    citationAlertTrackRepository,
    annotationPinRepository,
    annotationQuotationTypeRepository,
    labSnapshotRepository,
    readerAnnotationRepository,
    paperFieldRepository,
  };
}
