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
  IScreeningRepository,
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
  IReaderAnnotationSyncRecorder,
  IReaderAnnotationProjectSource,
  IReaderAnnotationSource,
  IBlobStore,
} from "@weaveforge/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWorkspaceChange } from "@/lib/workspace-changes";
import { watchWrites } from "./watch-writes";
import { ManageSettingsUseCase as ManageSettingsUseCaseClass } from "@weaveforge/core";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import { PostgrestDashboardLayoutRepository } from "@/features/dashboard/infrastructure/postgrest-dashboard-layout-repository";
import { PostgrestGraphSettingsRepository } from "@/features/relations/infrastructure/postgrest-graph-settings-repository";
import { PostgrestExperimentRepository } from "@/features/experiments/infrastructure/postgrest-experiment-repository";
import { PostgrestMetricRepository } from "@/features/experiments/infrastructure/postgrest-metric-repository";
import { PostgrestLogEntryRepository } from "@/features/logbook/infrastructure/postgrest-log-entry-repository";
import { PostgrestMemberRepository } from "@/features/org/infrastructure/postgrest-member-repository";
import { PostgrestSupervisionRepository } from "@/features/org/infrastructure/postgrest-supervision-repository";
import { PostgrestPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { PostgrestMilestoneRepository } from "@/features/plan/infrastructure/postgrest-milestone-repository";
import { PostgrestProjectRepository } from "@/features/projects/infrastructure/postgrest-project-repository";
import { ProjectZoteroStore } from "@/features/projects/infrastructure/project-zotero-store";
import {
  PostgrestReadingListRepository,
  PostgrestReadingListItemRepository,
} from "@/features/reading-lists/infrastructure/postgrest-reading-list-repository";
import { PostgrestScreeningRepository } from "@/features/reading-lists/infrastructure/postgrest-screening-repository";
import { PostgrestPaperRelationRepository } from "@/features/relations/infrastructure/postgrest-paper-relation-repository";
import { PostgrestCitationAlertTrackRepository } from "@/features/relations/infrastructure/postgrest-citation-alert-track-repository";
import { PostgrestAnnotationPinRepository } from "@/features/papers/infrastructure/postgrest-annotation-pin-repository";
import { PostgrestAnnotationQuotationTypeRepository } from "@/features/papers/infrastructure/postgrest-annotation-quotation-type-repository";
import { PostgrestLabSnapshotRepository } from "@/features/org/infrastructure/postgrest-lab-snapshot-repository";
import { PostgrestReaderAnnotationRepository } from "@/features/reader/infrastructure/postgrest-reader-annotation-repository";
import { PostgrestPaperFieldRepository } from "@/features/papers/infrastructure/postgrest-paper-field-repository";
import { PostgrestReportSectionRepository } from "@/features/report/infrastructure/postgrest-report-section-repository";
import { PostgrestVaultPageRepository } from "@/features/vault/infrastructure/postgrest-vault-page-repository";
import { PostgrestSettingsRepository } from "@/features/settings/infrastructure/postgrest-settings-repository";
import { secretsStoreFor } from "@/backend/providers/secrets-store";
import { PostgrestCommentRepository } from "@/features/sharing/infrastructure/postgrest-comment-repository";
import { PostgrestShareRepository } from "@/features/sharing/infrastructure/postgrest-share-repository";
import { PostgrestSharedReader } from "@/features/sharing/infrastructure/postgrest-shared-reader";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import { PostgrestIntegrationsStore } from "@/features/sync/infrastructure/postgrest-integrations-store";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import { PostgrestTagRepository, PostgrestPaperTagRepository } from "@/features/tags";
import { PostgrestLibraryPinRepository } from "@/features/library";
import type { ProjectContext } from "@/lib/project-context";
import { cacheRepo } from "@/lib/cache/cache-repo";
import type { BackendConfig } from "@/backend/config";
import { createDataClient } from "./client";
import { SupabaseSessionProvider } from "../supabase-auth/session";
import { SupabaseAdminUserProvisioner } from "../supabase-auth/admin-provisioner";
import { wireStorage } from "@/storage/wire-storage";

export interface WiredPostgrestBackend {
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
  readonly screeningRepository: IScreeningRepository;
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
    IReaderAnnotationSyncRecorder &
    IReaderAnnotationProjectSource;
  readonly paperFieldRepository: IPaperFieldRepository;
}

/**
 * What a copy working on this computer supplies instead of the server.
 *
 * Everything below this line is the same for both: the repositories only ever
 * see `db`, `session` and `auth`, so swapping those three swaps the backend
 * without a second copy of the wiring. See
 * `backend/providers/local/wire-local-backend.ts`.
 */
export interface BackendParts {
  db: SupabaseClient;
  session: ICurrentUserProvider;
  auth: IAuthService;
  blobStore: IBlobStore;
  /** Settings differ only in where the integration credentials are kept. */
  settingsRepository: ISettingsRepository;
}

export function wirePostgrestBackend(
  config: BackendConfig,
  projectContext: ProjectContext,
  pid: () => string | null,
  parts?: BackendParts,
): WiredPostgrestBackend {
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;
  if (!parts && (!url || !anonKey)) {
    throw new Error(
      "Supabase backend requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  // Wrapped once, here, so that every repository below reports its writes
  // without any of them having to know that something is listening.
  const db =
    parts?.db ??
    watchWrites(createDataClient(url as string, anonKey as string, config.dataUrl), notifyWorkspaceChange);
  const session = parts?.session ?? new SupabaseSessionProvider(db);
  const auth = parts?.auth ?? new SupabaseAuthService(db);
  const adminProvisioner =
    !parts && url && config.supabaseServiceRoleKey
      ? new SupabaseAdminUserProvisioner(url, config.supabaseServiceRoleKey)
      : null;

  const settingsRepository =
    parts?.settingsRepository ?? new PostgrestSettingsRepository(db, session, secretsStoreFor(db));
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository });
  const projectRepository = cacheRepo(
    new PostgrestProjectRepository(db, session),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "project" },
  );
  const dashboardLayoutRepository = cacheRepo(
    new PostgrestDashboardLayoutRepository(db),
    ["get"],
    ["save"],
    pid,
    { resourceType: "dashboard_layout" },
  );
  const graphSettingsRepository = cacheRepo(
    new PostgrestGraphSettingsRepository(db),
    ["get"],
    ["save"],
    pid,
    { resourceType: "graph_settings" },
  );
  const integrationsStore: IIntegrationsStore = new PostgrestIntegrationsStore(db);
  const paperRepository = cacheRepo(
    new PostgrestPaperRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "paper" },
  );

  const tagPaperCache = new Map<string, Promise<unknown>>();
  const tagPaperSettled = new Map<string, unknown>();
  const tagRepository = cacheRepo(
    new PostgrestTagRepository(db, projectContext),
    ["getById", "findByName", "list", "listWithCounts"],
    ["save", "delete"],
    pid,
    { resourceType: "tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );
  const paperTagRepository = cacheRepo(
    new PostgrestPaperTagRepository(db),
    ["listForPaper", "listForTag", "listAll"],
    ["link", "unlink", "unlinkBySource", "reconcile"],
    pid,
    { resourceType: "paper_tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );

  const logEntryRepository = cacheRepo(
    new PostgrestLogEntryRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "log_entry" },
  );
  const reportSectionRepository = cacheRepo(
    new PostgrestReportSectionRepository(db, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "report_section" },
  );
  // "raw" is about the projection, not the caching: it returns full bodies
  // where the screen loader takes summaries. It was the last uncached
  // repository, so every consumer that wanted real note bodies — wiki, search,
  // export, the folder mirror — paid its own round trip on the same page.
  const rawVaultPageRepository = cacheRepo(
    new PostgrestVaultPageRepository(db, projectContext),
    ["getById", "list", "listSummaries", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "vault_page" },
  );
  const readingListRepository = cacheRepo(
    new PostgrestReadingListRepository(db, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "reading_list" },
  );
  const readingListItemRepository = cacheRepo(
    new PostgrestReadingListItemRepository(db),
    ["listItems", "listItemsForLists", "listsForPaper", "find"],
    ["add", "remove"],
    pid,
    { resourceType: "reading_list_item" },
  );
  // Not cached: a decision another reviewer records is the point of the screen,
  // and a cache would show you your own half of it until something evicted.
  const screeningRepository = new PostgrestScreeningRepository(db);

  const paperRelationRepository = cacheRepo(
    new PostgrestPaperRelationRepository(db, projectContext),
    ["getById", "list", "getGraph", "relationsFor", "findEdge"],
    ["save", "delete"],
    pid,
    { resourceType: "paper_relation" },
  );
  const experimentRepository = cacheRepo(
    new PostgrestExperimentRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "experiment" },
  );
  const metricRepository = new PostgrestMetricRepository(db);
  const shareRepository = cacheRepo(
    new PostgrestShareRepository(db, session),
    ["listForResource", "listSharedWithMe"],
    ["grant", "revoke"],
    pid,
    { resourceType: "share" },
  );
  const commentRepository = new PostgrestCommentRepository(db);
  const sharedReader: ISharedReader = cacheRepo(
    new PostgrestSharedReader(db),
    ["read"],
    [],
    pid,
  );
  const milestoneRepository = cacheRepo(
    new PostgrestMilestoneRepository(db, projectContext),
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
    new PostgrestMemberRepository(db, session),
    ["getMine", "listTeam", "listDirectory", "listLab"],
    [],
    pid,
  );
  const supervisionRepository = new PostgrestSupervisionRepository(db);
  const projectBibliographyCollection = new ProjectZoteroStore(db);
  const rawBlobStore = parts?.blobStore ?? wireStorage({ supabaseDb: db });
  const libraryPinRepository: ILibraryPinRepository = cacheRepo(
    new PostgrestLibraryPinRepository(db, projectContext, session),
    ["listForProject", "isPinned"],
    ["pin", "unpin"],
    pid,
    { resourceType: "library_pin" },
  );
  const citationAlertTrackRepository: ICitationAlertTrackRepository = cacheRepo(
    new PostgrestCitationAlertTrackRepository(db, projectContext, session),
    ["listForProject", "getByPaperId"],
    ["track", "untrack", "save"],
    pid,
    { resourceType: "citation_alert_track" },
  );
  const annotationPinRepository: IAnnotationPinRepository = cacheRepo(
    new PostgrestAnnotationPinRepository(db, projectContext, session),
    ["listForProject", "listForPaper", "listForSection"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const annotationQuotationTypeRepository: IAnnotationQuotationTypeRepository = cacheRepo(
    new PostgrestAnnotationQuotationTypeRepository(db, projectContext, session),
    ["listForPaper"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const labSnapshotRepository: ILabSnapshotRepository = cacheRepo(
    new PostgrestLabSnapshotRepository(db, projectContext, session),
    ["listMine", "listForMember", "getById"],
    ["publish", "remove"],
    pid,
    { resourceType: "project" },
  );
  const readerAnnotationRepository = cacheRepo(
    new PostgrestReaderAnnotationRepository(db, projectContext, session),
    ["list", "listForProject"],
    ["create", "update", "remove", "recordZoteroSync"],
    pid,
    { resourceType: "paper" },
  );
  const paperFieldRepository: IPaperFieldRepository = cacheRepo(
    new PostgrestPaperFieldRepository(db, projectContext, session),
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
    screeningRepository,
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
