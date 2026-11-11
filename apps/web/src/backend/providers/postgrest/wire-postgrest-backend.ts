import type { BackendConfig } from "@/backend/parts";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/postgrest/parts-1";
import { secretsStoreFor } from "@/backend/providers/secrets-store";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import {
  PostgrestExperimentRepository,
  PostgrestMetricRepository,
} from "@/features/experiments/infrastructure/parts";
import {
  PostgrestLogEntryRepository,
} from "@/features/logbook/infrastructure/parts";
import {
  labSnapshotRepository as rustLabSnapshotRepository,
  supervisionRepository as rustSupervisionRepository,
} from "@/features/org/infrastructure/parts";
import { memberRepository as rustMemberRepository } from "@/features/org/infrastructure/postgrest-member-repository";
import {
  PostgrestAnnotationPinRepository,
  PostgrestPaperFieldRepository,
} from "@/features/papers/infrastructure/parts-1";
import {
  PostgrestPaperRepository,
} from "@/features/papers/infrastructure/postgrest-paper-repository";
import {
  type MilestoneRow,
  milestoneToDomain,
} from "@/features/plan/infrastructure/milestone-rows";
import {
  PostgrestReaderAnnotationRepository,
} from "@/features/reader/infrastructure/parts-1";
import {
  PostgrestReadingListItemRepository,
  PostgrestReadingListRepository,
  PostgrestScreeningRepository,
} from "@/features/reading-lists/infrastructure/parts";
import {
  PostgrestCitationAlertTrackRepository,
} from "@/features/relations/infrastructure/parts";
import {
  PostgrestReportSectionRepository,
} from "@/features/report/infrastructure/parts";
import {
  PostgrestSettingsRepository,
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
  type IExperimentRepository,
  type IGraphSettingsRepository,
  type ILabSnapshotRepository,
  type ILibraryPinRepository,
  type ILogEntryRepository,
  type IMemberRepository,
  type IMetricRepository,
  type IMilestoneRepository,
  type IPaperFieldRepository,
  type IPaperRelationRepository,
  type IPaperRepository,
  type IPaperTagRepository,
  type IProjectBibliographyCollectionStore,
  type IProjectRepository,
  type IReaderAnnotationProjectSource,
  type IReaderAnnotationSink,
  type IReaderAnnotationSource,
  type IReaderAnnotationSyncRecorder,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IReportSectionRepository,
  type IScreeningRepository,
  type ISettingsRepository,
  type IShareRepository,
  type ISupervisionRepository,
  type ITagRepository,
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
import { createDataClient, KeyedColumnRepository, SpecRepository } from "./parts-1";
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

// --- integrations-rows ---
/**
 * How integrations rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface IntegrationRow {
  provider: SyncProvider;
  enabled: boolean;
  token: string | null;
  repo: string | null;
  branch: string | null;
  options?: Record<string, unknown> | null;
}

// --- postgrest-integrations-store ---
/** Reads/writes `project_integrations` per (project, provider). */
export class PostgrestIntegrationsStore {
  constructor(private readonly db: SupabaseClient) {}

  async get(projectId: string, provider: SyncProvider): Promise<Integration> {
    const { data, error } = await this.db
      .from("project_integrations")
      .select("provider,enabled,token,repo,branch,options")
      .eq("project_id", projectId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    if (!data) return readyCore().emptyIntegration(provider);
    const r = data as IntegrationRow;
    return {
      provider,
      enabled: r.enabled,
      token: r.token ?? undefined,
      repo: r.repo ?? undefined,
      branch: readyCore().branchRead({ provider, branch: r.branch ?? null }),
      options: r.options ?? undefined,
    };
  }

  async save(projectId: string, integration: Integration): Promise<void> {
    await run(this.db.from("project_integrations").upsert(
      {
        project_id: projectId,
        provider: integration.provider,
        enabled: integration.enabled,
        token: integration.token ?? null,
        repo: integration.repo ?? null,
        // For Mattermost this is the channel id; a blank one stays blank.
        branch: readyCore().branchSave({ provider: integration.provider, branch: integration.branch ?? "" }),
        options: integration.options ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,provider" },
    ));
  }
}

// --- project-rows ---
/**
 * How project rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export function toDomain(r: ProjectRow): Project {
  const p = readyCore().projectFromRow(r);
  return { id: p.id, name: p.name, color: p.color ?? undefined, createdAt: p.createdAt };
}

// --- postgrest-project-repository ---
/**
 * The columns a ProjectRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const PROJECT_COLUMNS = "id,name,color,created_at";

const TABLE = "projects";

export class PostgrestProjectRepository implements IProjectRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getById(id: string): Promise<Project | null> {
    const row = await rowById<ProjectRow>(this.db, TABLE, id);
    return row ? toDomain(row) : null;
  }
  async list(): Promise<Project[]> {
    return (await rows<ProjectRow>(this.db.from(TABLE).select(PROJECT_COLUMNS).order("created_at"))).map(toDomain);
  }
  async save(entity: Project): Promise<void> {
    const userId = await this.session.getCurrentUserId();
    await run(this.db.from(TABLE).upsert({
      id: entity.id,
      user_id: userId,
      name: entity.name,
      color: entity.color ?? null,
      created_at: entity.createdAt,
    }));
  }
  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

// --- shared-reader-sources ---
/** Per-type row mapping: which table, and which columns hold the title/status. */
export const SHARED_SOURCES: Record<
  ShareableType,
  { table: string; title: string; status: string | null }
> = {
  milestone: { table: "milestones", title: "title", status: "status" },
  experiment: { table: "experiments", title: "name", status: "status" },
  report_section: { table: "report_sections", title: "title", status: "status" },
  reading_list: { table: "reading_lists", title: "name", status: null },
  paper: { table: "papers", title: "title", status: "status" },
  vault_page: { table: "vault_pages", title: "title", status: null },
};

/**
 * Shape one row into a `SharedItem`.
 *
 * Shared by the PostgREST and Postgres readers deliberately: they differ in how
 * they *fetch* — PostgREST `.or()` filters against SQL `any($n::uuid[])` — but
 * a shared item must look identical whichever backend produced it, and this
 * mapping had drifted into two copies of the same twelve lines.
 */
export function toSharedItem(kind: ShareableType, row: Record<string, unknown>): SharedItem {
  return readyCore().sharedItem(kind, row, SHARED_SOURCES[kind]);
}

// --- postgrest-shared-reader ---
/**
 * Fetches the actual rows behind a set of shares — by id (per-item grants) or by
 * owner (blanket "share everything" grants). Reads whatever the widened SELECT
 * policies (0018) permit, independent of the project-scoped feature repos.
 */
export class PostgrestSharedReader implements ISharedReader {
  constructor(private readonly db: import("@supabase/supabase-js").SupabaseClient) {}

  async read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]> {
    // Table, columns and filter come from Rust (`shared_read_plan`); no plan, no request.
    const plan = readyCore().sharedReadPlan(kind, ids, owners);
    if (!plan) return [];

    const { data, error } = await this.db.from(plan.table).select(plan.columns).or(plan.filter);
    if (error) throw error;
    // The dynamic column list makes PostgREST infer an error type; the rows are
    // plain records, so cast through unknown.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => toSharedItem(kind, r));
  }
}

// --- project-zotero-store ---
/**
 * Per-project Zotero collection mapping. Reads/writes `projects.zotero_collection`.
 * The API key + library are per-user (user_settings); only the target collection
 * is per-project, so a project syncs to its own Zotero collection.
 */
export class ProjectZoteroStore implements IProjectBibliographyCollectionStore {
  constructor(private readonly db: SupabaseClient) {}

  async getCollection(projectId: string): Promise<string | undefined> {
    const { data, error } = await this.db
      .from("projects")
      .select("zotero_collection")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    return (data as { zotero_collection: string | null } | null)?.zotero_collection ?? undefined;
  }

  async setCollection(projectId: string, collection: string | null): Promise<void> {
    await run(this.db
      .from("projects")
      .update({ zotero_collection: collection || null })
      .eq("id", projectId));
  }
}

// --- wire-postgrest-backend ---
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
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository, clock: systemClock });
  const projectRepository = cacheRepo(
    new PostgrestProjectRepository(db, session),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "project" },
  );
  const dashboardLayoutRepository = cacheRepo(
    new KeyedColumnRepository<DashboardLayout>(db, "dashboardLayout", (raw) =>
      readyCore().parseDashboardLayout(raw as never) as DashboardLayout | null),
    ["get"],
    ["save"],
    pid,
    { resourceType: "dashboard_layout" },
  );
  const graphSettingsRepository = cacheRepo(
    new KeyedColumnRepository<GraphPersistedState>(db, "graphSettings", (raw) =>
      typedCore().parseGraphPersistedState(raw as never)),
    ["get"],
    ["save"],
    pid,
    { resourceType: "graph_settings" },
  );
  const integrationsStore: IIntegrationsStore = new PostgrestIntegrationsStore(db);
  const paperRepository = cachePaperRepository(new PostgrestPaperRepository(db, projectContext), pid);

  const tagPaperCache = new Map<string, Promise<unknown>>();
  const tagPaperSettled = new Map<string, unknown>();
  const tagRepository = cacheRepo(
    rustRepository<ITagRepository>(
      db,
      "tags",
      ["getById", "findByName", "list", "listWithCounts", "save", "delete"],
      projectUserCtx(projectContext),
    ),
    ["getById", "findByName", "list", "listWithCounts"],
    ["save", "delete"],
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
    rustVaultPageRepository(db, projectContext),
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
    new PostgrestExperimentRepository(db, projectContext),
    ["getById", "list"],
    ["save", "patch", "delete"],
    pid,
    { resourceType: "experiment" },
  );
  const metricRepository = new PostgrestMetricRepository(db);
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
    new PostgrestSharedReader(db),
    ["read"],
    [],
    pid,
    { resourceType: "share" },
  );
  const milestoneRepository = cacheRepo(
    new SpecRepository<Milestone, MilestoneRow, MilestoneFilter>(db, projectContext, "milestones", {
      toDomain: milestoneToDomain,
      toRow: (m) => readyCore().milestoneToRow(m),
    }),
    ["getById", "list"],
    ["save", "delete"],
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
  const projectBibliographyCollection = new ProjectZoteroStore(db);
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
    dispose: () => ownSession?.dispose(),
  };
}
