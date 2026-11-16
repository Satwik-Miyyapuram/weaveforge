import type { BackendConfig } from "@/backend/parts";
import { secretsStoreFor } from "@/backend/providers/secrets-store";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import {
  rustExperimentRepository,
  rustMetricRepository,
} from "@/features/experiments/infrastructure/parts";
import {
  labSnapshotRepository as rustLabSnapshotRepository,
  supervisionRepository as rustSupervisionRepository,
} from "@/features/org/infrastructure/parts";
import { memberRepository as rustMemberRepository } from "@/features/org/infrastructure/postgrest-member-repository";
import {
  rustAnnotationPinRepository,
  rustPaperFieldRepository,
} from "@/features/papers/infrastructure/parts-1";
import { rustPaperRepository } from "@/features/papers/infrastructure/postgrest-paper-repository";
import { rustMilestoneRepository } from "@/features/plan/infrastructure/milestone-rows";
import { rustReaderAnnotationRepository } from "@/features/reader/infrastructure/parts-1";
import {
  PostgrestSettingsRepository,
  type IReleaseNoticesRepository,
  type SettingsWrites,
} from "@/features/settings/infrastructure/parts";
import type { IIntegrationsStore } from "@/features/sync/domain/parts";
import { cacheRepo } from "@/lib/cache/parts-1";
import type { ProjectContext } from "@/lib/parts-2";
import { readyCore, typedCore } from "@/lib/rust-core";
import { notifyWorkspaceChange, systemClock } from "@/lib/parts";
import { wireStorage } from "@/storage/wire-storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type DashboardLayout,
  type GraphPersistedState,
  type IAdminUserProvisioner,
  type IAnnotationPinRepository,
  type IAnnotationQuotationTypeRepository,
  type IAuthService,
  type IBlobStore,
  type ICitationAlertTrackRepository,
  type ICommentRepository,
  type ICurrentUserProvider,
  type IDashboardLayoutRepository,
  type IExperimentManager,
  type IExperimentRepository,
  type IGraphSettingsRepository,
  type ILabSnapshotRepository,
  type ILibraryPinRepository,
  type ILogEntryManager,
  type ILogEntryRepository,
  type IMemberRepository,
  type IMetricRepository,
  type IMilestoneManager,
  type IMilestoneRepository,
  type IPaperFieldRepository,
  type IPaperRelationRepository,
  type IPaperRepository,
  type IPaperTagRepository,
  type IProjectBibliographyCollectionStore,
  type IProjectManager,
  type IProjectRepository,
  type IReaderAnnotationProjectSource,
  type IReaderAnnotationSink,
  type IReaderAnnotationSource,
  type IReaderAnnotationSyncRecorder,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IReportSectionManager,
  type IReportSectionRepository,
  type IScreeningRepository,
  type ReadingList,
  type ISettingsRepository,
  type IShareRepository,
  type ISupervisionRepository,
  type ITagManager,
  type ITagRepository,
  type IVaultPageManager,
  type IVaultPageRepository,
  type ManageSettingsUseCase,
  ManageSettingsUseCase as ManageSettingsUseCaseClass,
  type Milestone,
  type MilestoneFilter,
  type Project,
  type ShareableType,
} from "@weaveforge/core";
import type { ISharedReader, SharedItem } from "../../../features/sharing/domain/shared-reader";
import type { Integration, SyncProvider } from "../../../features/sync/domain/parts";
import { SupabaseAdminUserProvisioner, SupabaseSessionProvider } from "../supabase-auth/parts";
import { createDataClient } from "./parts-1";
import { projectUserCtx, rustRepository, rustVaultPageRepository } from "./rust-repository";
import { watchWrites } from "./watch-writes";

export type { SharedItem } from "../../../features/sharing/domain/shared-reader";

// --- cached-paper-repository ---
/**
 * What the read memo does with each repository method.
 *
 * A record over every method rather than two lists, so a method added to the
 * port does not compile until someone decides. A write left off the list
 * keeps the memo, and the next read paints the row as it was before.
 */
const PAPER_METHODS: Record<keyof IPaperRepository, "read" | "write" | "uncached"> = {
  getById: "read",
  list: "read",
  listSummaries: "uncached",
  findByArxivId: "uncached",
  findByDoi: "uncached",
  findByTitleKey: "uncached",
  findIdentityByArxivId: "uncached",
  findIdentityByDoi: "uncached",
  save: "write",
  delete: "write",
  setTags: "write",
  replaceSummary: "write",
};

function methods(kind: "read" | "write"): string[] {
  return Object.entries(PAPER_METHODS)
    .filter(([, value]) => value === kind)
    .map(([name]) => name);
}

/** The paper repository behind the project-scoped read memo. */
export function cachePaperRepository<R extends IPaperRepository>(inner: R, pid: () => string | null): R {
  return cacheRepo(inner, methods("read"), methods("write"), pid, { resourceType: "paper" });
}

// --- rust-backed stores ---
/** `project_integrations` per (project, provider), through the Rust step engine. */
export function rustIntegrationsStore(db: SupabaseClient): IIntegrationsStore {
  return rustRepository<IIntegrationsStore>(db, "project_integrations", ["get", "save"]);
}

/** `projects` through the Rust step engine; `save` stamps the signed-in user. */
function rustProjectRepository(db: SupabaseClient, session: ICurrentUserProvider): IProjectRepository & IProjectManager {
  return rustRepository<IProjectRepository & IProjectManager>(db, "projects", ["getById", "list", "save", "delete", "create", "remove"], async () => ({
    userId: (await session.getCurrentUserId()) ?? undefined,
  }));
}

/**
 * The rows behind a set of shares, by id (per-item grants) or by owner (blanket
 * grants). Rust plans the read (`repos/shared_items.rs`); no grants, no request.
 */
function rustSharedReader(db: SupabaseClient): ISharedReader {
  return rustRepository<ISharedReader>(db, "shared_items", ["read"]);
}

/**
 * Per-project Zotero collection (`projects.zotero_collection`). The API key and
 * library are per user; only the target collection is per project.
 */
function rustProjectZoteroStore(db: SupabaseClient): IProjectBibliographyCollectionStore {
  type Wire = { getCollection(projectId: string): Promise<string | null>; setCollection(projectId: string, collection: string | null): Promise<void> };
  const repo = rustRepository<Wire>(db, "projects", ["getCollection", "setCollection"]);
  return {
    getCollection: async (projectId) => (await repo.getCollection(projectId)) ?? undefined,
    setCollection: (projectId, collection) => repo.setCollection(projectId, collection),
  };
}

// --- wire-postgrest-backend ---
export interface WiredPostgrestBackend {
  readonly config: BackendConfig;
  readonly db: SupabaseClient;
  readonly session: ICurrentUserProvider;
  readonly auth: IAuthService;
  readonly adminProvisioner: IAdminUserProvisioner | null;
  readonly projectContext: ProjectContext;
  readonly settingsRepository: ISettingsRepository & SettingsWrites;
  readonly releaseNoticesRepository: IReleaseNoticesRepository;
  readonly manageSettings: ManageSettingsUseCase;
  readonly projectRepository: IProjectRepository & IProjectManager;
  readonly dashboardLayoutRepository: IDashboardLayoutRepository;
  readonly graphSettingsRepository: IGraphSettingsRepository;
  readonly integrationsStore: IIntegrationsStore;
  readonly paperRepository: IPaperRepository;
  readonly tagRepository: ITagRepository & ITagManager;
  readonly paperTagRepository: IPaperTagRepository;
  readonly logEntryRepository: ILogEntryRepository & ILogEntryManager;
  readonly reportSectionRepository: IReportSectionRepository & IReportSectionManager;
  readonly readingListRepository: IReadingListRepository;
  readonly readingListItemRepository: IReadingListItemRepository;
  readonly screeningRepository: IScreeningRepository;
  readonly paperRelationRepository: IPaperRelationRepository;
  readonly experimentRepository: IExperimentRepository & IExperimentManager;
  readonly metricRepository: IMetricRepository;
  readonly shareRepository: IShareRepository;
  readonly commentRepository: ICommentRepository;
  readonly sharedReader: ISharedReader;
  readonly milestoneRepository: IMilestoneRepository & IMilestoneManager;
  readonly memberRepository: IMemberRepository & { assertCanCreate(role: string): Promise<void> };
  readonly supervisionRepository: ISupervisionRepository;
  readonly projectBibliographyCollection: IProjectBibliographyCollectionStore;
  readonly rawBlobStore: IBlobStore;
  readonly rawVaultPageRepository: IVaultPageRepository & IVaultPageManager;
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
  /** Release what this wiring subscribed to (the session's auth listener). */
  dispose(): void;
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
  settingsRepository: ISettingsRepository & SettingsWrites;
  /** Offline copies have no release notices; the server supplies them otherwise. */
  releaseNotices?: IReleaseNoticesRepository;
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
  // A session built here listens on the client; one passed in is its owner's.
  const ownSession = parts?.session ? null : new SupabaseSessionProvider(db);
  const session = parts?.session ?? ownSession!;
  const auth = parts?.auth ?? new SupabaseAuthService(db);
  const adminProvisioner =
    !parts && url && config.supabaseServiceRoleKey
      ? new SupabaseAdminUserProvisioner(url, config.supabaseServiceRoleKey)
      : null;

  const settingsRepository =
    parts?.settingsRepository ?? new PostgrestSettingsRepository(db, session, secretsStoreFor(db));
  const releaseNoticesRepository =
    parts?.releaseNotices ??
    rustRepository<IReleaseNoticesRepository>(db, "release_notices", ["unseen"], async () => ({
      userId: (await session.getCurrentUserId()) ?? undefined,
    }));
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository, clock: systemClock });
  const projectRepository = cacheRepo(
    rustProjectRepository(db, session),
    ["getById", "list"],
    ["save", "delete", "create", "remove"],
    pid,
    { resourceType: "project" },
  );
  const dashboardLayoutRepository = cacheRepo(
    rustRepository<IDashboardLayoutRepository>(db, "dashboardLayout", ["get", "save"]),
    ["get"],
    ["save"],
    pid,
    { resourceType: "dashboard_layout" },
  );
  const graphSettingsRepository = cacheRepo(
    rustRepository<IGraphSettingsRepository>(db, "graphSettings", ["get", "save"]),
    ["get"],
    ["save"],
    pid,
    { resourceType: "graph_settings" },
  );
  const integrationsStore: IIntegrationsStore = rustIntegrationsStore(db);
  const paperRepository = cachePaperRepository(rustPaperRepository(db, projectContext), pid);

  const tagPaperCache = new Map<string, Promise<unknown>>();
  const tagPaperSettled = new Map<string, unknown>();
  // Tag membership writes (setManualTags, mergeTags, ...) go through the same
  // cached repo so the tag cache and the write notification stay in one place.
  const tagRepository = cacheRepo(
    rustRepository<ITagRepository & ITagManager>(
      db,
      "tags",
      [
        "getById",
        "findByName",
        "list",
        "listAll",
        "listWithCounts",
        "listForPaper",
        "listPapersForTag",
        "listPaperTagLinks",
        "save",
        "delete",
        "setManualTags",
        "mergeTags",
        "removeManualTag",
        "reconcileSources",
        "mergeConcepts",
        "refreshPaperCache",
      ],
      projectUserCtx(projectContext),
    ),
    ["getById", "findByName", "list", "listAll", "listWithCounts", "listForPaper", "listPapersForTag", "listPaperTagLinks"],
    ["save", "delete", "setManualTags", "mergeTags", "removeManualTag", "reconcileSources", "mergeConcepts", "refreshPaperCache"],
    pid,
    { resourceType: "tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );
  const paperTagRepository = cacheRepo(
    rustRepository<IPaperTagRepository>(db, "paper_tags", [
      "listForPaper",
      "listForTag",
      "listAll",
      "link",
      "unlink",
      "unlinkBySource",
      "reconcile",
    ]),
    ["listForPaper", "listForTag", "listAll"],
    ["link", "unlink", "unlinkBySource", "reconcile"],
    pid,
    { resourceType: "paper_tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );

  const logEntryRepository = cacheRepo(
    rustRepository<ILogEntryRepository & ILogEntryManager>(db, "log_entries", ["getById", "list", "save", "delete", "add", "update", "remove"], projectUserCtx(projectContext)),
    ["getById", "list"],
    ["save", "delete", "add", "update", "remove"],
    pid,
    { resourceType: "log_entry" },
  );
  const reportSectionRepository = cacheRepo(
    rustRepository<IReportSectionRepository & IReportSectionManager>(
      db,
      "report_sections",
      [
        "getById",
        "list",
        "getTree",
        "save",
        "delete",
        "add",
        "setTitle",
        "setParent",
        "setStatus",
        "setProgress",
        "setNotes",
        "remove",
      ],
      projectUserCtx(projectContext),
    ),
    ["getById", "list", "getTree"],
    ["save", "delete", "add", "setTitle", "setParent", "setStatus", "setProgress", "setNotes", "remove"],
    pid,
    { resourceType: "report_section" },
  );
  // "raw" is about the projection, not the caching: it returns full bodies
  // where the screen loader takes summaries. It was the last uncached
  // repository, so every consumer that wanted real note bodies — wiki, search,
  // export, the folder mirror — paid its own round trip on the same page.
  const rawVaultPageRepository = cacheRepo(
    rustVaultPageRepository(db, projectContext),
    ["getById", "list", "listSummaries", "getTree"],
    ["save", "delete", "add", "update", "remove"],
    pid,
    { resourceType: "vault_page" },
  );
  const readingListRepository = cacheRepo(
    rustRepository<IReadingListRepository & { listByIds(ids: readonly string[]): Promise<ReadingList[]> }>(
      db,
      "reading_lists",
      ["getById", "listByIds", "list", "getTree", "save", "delete"],
      projectUserCtx(projectContext),
    ),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "reading_list" },
  );
  const readingListItemRepository = cacheRepo(
    rustRepository<IReadingListItemRepository>(db, "reading_list_items", [
      "listItems",
      "listItemsForLists",
      "listsForPaper",
      "listsForNote",
      "find",
      "findNote",
      "add",
      "remove",
    ] as (keyof IReadingListItemRepository & string)[]),
    ["listItems", "listItemsForLists", "listsForPaper", "find"],
    ["add", "remove"],
    pid,
    { resourceType: "reading_list_item" },
  );
  // Not cached: a decision another reviewer records is the point of the screen,
  // and a cache would show you your own half of it until something evicted.
  const screeningRepository = rustRepository<IScreeningRepository>(db, "screening_decisions", [
    "listForItems",
    "record",
    "remove",
  ]);

  const paperRelationRepository = cacheRepo(
    rustRepository<IPaperRelationRepository>(
      db,
      "paper_relations",
      ["getById", "list", "getGraph", "relationsFor", "findEdge", "save", "delete"],
      projectUserCtx(projectContext),
    ),
    ["getById", "list", "getGraph", "relationsFor", "findEdge"],
    ["save", "delete"],
    pid,
    { resourceType: "paper_relation" },
  );
  const experimentRepository = cacheRepo(
    rustExperimentRepository(db, projectContext),
    ["getById", "list"],
    ["save", "patch", "delete", "add", "setStatus", "recordMetrics", "addArtifacts", "setResultNote", "remove"],
    pid,
    { resourceType: "experiment" },
  );
  const metricRepository = rustMetricRepository(db);
  const shareRepository = cacheRepo(
    rustRepository<IShareRepository>(
      db,
      "shares",
      ["grant", "revoke", "listForResource", "listSharedWithMe"],
      projectUserCtx(projectContext, session),
    ),
    ["listForResource", "listSharedWithMe"],
    ["grant", "revoke"],
    pid,
    { resourceType: "share" },
  );
  const commentRepository = rustRepository<ICommentRepository>(db, "comments", ["list", "add", "remove", "setResolved"]);
  // What you can read depends on the grants, so a share change (yours or a
  // peer's broadcast) clears this memo with the share repository's.
  const sharedReader: ISharedReader = cacheRepo(
    rustSharedReader(db),
    ["read"],
    [],
    pid,
    { resourceType: "share" },
  );
  const milestoneRepository = cacheRepo(
    rustMilestoneRepository(db, projectContext),
    ["getById", "list"],
    ["save", "delete", "add", "setStatus", "update", "remove"],
    pid,
    { resourceType: "milestone" },
  );
  // The only repository that was not cached. Its reads hit `profiles`, whose
  // RLS predicate calls the recursive `lab_root` per row — measured at ~1.8s
  // against a real database, dwarfing every other query on a screen load. Five
  // screens await it before rendering, and it was refetched on each of them.
  // Membership rarely changes during a session, so it caches like the rest; the
  // org calls that change it (create, join, roles, new accounts) clear every memo.
  const memberRepository = cacheRepo(
    rustMemberRepository(db, session),
    ["getMine", "listTeam", "listDirectory", "listLab"],
    [],
    pid,
  );
  const supervisionRepository = rustSupervisionRepository(db);
  const projectBibliographyCollection = rustProjectZoteroStore(db);
  const rawBlobStore = parts?.blobStore ?? wireStorage({ supabaseDb: db });
  const libraryPinRepository: ILibraryPinRepository = cacheRepo(
    rustRepository<ILibraryPinRepository>(
      db,
      "library_pins",
      ["pin", "unpin", "listForProject", "isPinned"],
      projectUserCtx(projectContext, session),
    ),
    ["listForProject", "isPinned"],
    ["pin", "unpin"],
    pid,
    { resourceType: "library_pin" },
  );
  const citationAlertTrackRepository: ICitationAlertTrackRepository = cacheRepo(
    rustRepository<ICitationAlertTrackRepository>(
      db,
      "citation_alert_tracks",
      ["track", "untrack", "listForProject", "getByPaperId", "save"],
      projectUserCtx(projectContext, session),
    ),
    ["listForProject", "getByPaperId"],
    ["track", "untrack", "save"],
    pid,
    { resourceType: "citation_alert_track" },
  );
  const annotationPinRepository: IAnnotationPinRepository = cacheRepo(
    rustAnnotationPinRepository(db, projectContext, session),
    ["listForProject", "listForPaper", "listForSection"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const annotationQuotationTypeRepository: IAnnotationQuotationTypeRepository = cacheRepo(
    rustRepository<IAnnotationQuotationTypeRepository>(
      db,
      "annotation_quotation_types",
      ["save", "remove", "listForPaper"],
      projectUserCtx(projectContext, session),
    ),
    ["listForPaper"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const labSnapshotRepository: ILabSnapshotRepository = cacheRepo(
    rustLabSnapshotRepository(db, projectContext, session),
    ["listMine", "listForMember", "getById"],
    ["publish", "remove"],
    pid,
    { resourceType: "project" },
  );
  const readerAnnotationRepository = cacheRepo(
    rustReaderAnnotationRepository(db, projectContext, session),
    ["list", "listForProject"],
    ["create", "update", "remove", "recordZoteroSync"],
    pid,
    { resourceType: "paper" },
  );
  const paperFieldRepository: IPaperFieldRepository = cacheRepo(
    rustPaperFieldRepository(db, projectContext, session),
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
    releaseNoticesRepository,
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
    dispose: () => ownSession?.dispose(),
  };
}
