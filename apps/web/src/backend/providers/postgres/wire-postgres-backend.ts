/**
 * Phase 2 Postgres provider — auth stays on Supabase; relational data uses DATABASE_URL.
 * See docs/backend/postgres-provider.md.
 */
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
  ManageSettingsUseCase,
  ILibraryPinRepository,
  ICitationAlertTrackRepository,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  ILabSnapshotRepository,
  IPaperFieldRepository,
} from "@thesis/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ManageSettingsUseCase as ManageSettingsUseCaseClass } from "@thesis/core";
import { SupabaseAuthService } from "@/features/auth/infrastructure/supabase-auth";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import type { IIntegrationsStore } from "@/features/sync/domain/sync-ports";
import type { ProjectContext } from "@/lib/project-context";
import { cacheRepo } from "@/lib/cache-repo";
import type { BackendConfig } from "@/backend/config";

const USER_SCOPE = () => "user";
import { createSupabaseClient } from "../supabase/client";
import { SupabaseSessionProvider } from "../supabase/session";
import { SupabaseAdminUserProvisioner } from "../supabase/admin-provisioner";
import type { WiredSupabaseBackend } from "../supabase/wire-supabase-backend";
import { wireStorage } from "@/storage/wire-storage";
import { getPgPool } from "./pool";
import { PgRunner } from "./pg-runner";
import { PostgresPaperRepository } from "./repositories/paper-repository";
import { PostgresProjectRepository } from "./repositories/project-repository";
import { PostgresSettingsRepository } from "./repositories/settings-repository";
import { PostgresLogEntryRepository } from "./repositories/log-entry-repository";
import { PostgresMilestoneRepository } from "./repositories/milestone-repository";
import { PostgresReportSectionRepository } from "./repositories/report-section-repository";
import { PostgresVaultPageRepository } from "./repositories/vault-page-repository";
import {
  PostgresReadingListRepository,
  PostgresReadingListItemRepository,
} from "./repositories/reading-list-repository";
import { PostgresPaperRelationRepository } from "./repositories/paper-relation-repository";
import { PostgresTagRepository, PostgresPaperTagRepository } from "./repositories/tag-repository";
import { PostgresExperimentRepository } from "./repositories/experiment-repository";
import { PostgresMetricRepository } from "./repositories/metric-repository";
import { PostgresDashboardLayoutRepository } from "./repositories/dashboard-layout-repository";
import { PostgresGraphSettingsRepository } from "./repositories/graph-settings-repository";
import { PostgresShareRepository } from "./repositories/share-repository";
import { PostgresCommentRepository } from "./repositories/comment-repository";
import { PostgresSharedReader } from "./repositories/shared-reader";
import { PostgresLibraryPinRepository } from "./repositories/library-pin-repository";
import { PostgresCitationAlertTrackRepository } from "./repositories/citation-alert-track-repository";
import { PostgresAnnotationPinRepository } from "./repositories/annotation-pin-repository";
import { PostgresAnnotationQuotationTypeRepository } from "./repositories/annotation-quotation-type-repository";
import { PostgresLabSnapshotRepository } from "./repositories/lab-snapshot-repository";
import { PostgresPaperFieldRepository } from "./repositories/paper-field-repository";
import { PostgresMemberRepository } from "./repositories/member-repository";
import { PostgresSupervisionRepository } from "./repositories/supervision-repository";
import { PostgresIntegrationsStore } from "./repositories/integrations-store";
import { PostgresProjectBibliographyCollectionStore } from "./repositories/project-bibliography-collection-store";
import { PostgresBlobRegistry } from "@/storage/providers/postgres/blob-registry";

export type WiredPostgresBackend = WiredSupabaseBackend;

export function wirePostgresBackend(
  config: BackendConfig,
  projectContext: ProjectContext,
  pid: () => string | null,
): WiredPostgresBackend {
  const databaseUrl = config.databaseUrl;
  if (!databaseUrl) {
    throw new Error(
      "Postgres backend requires DATABASE_URL. Set NEXT_PUBLIC_BACKEND_PROVIDER=supabase until OCI Postgres is ready.",
    );
  }
  const url = config.supabaseUrl;
  const anonKey = config.supabaseAnonKey;
  if (!url || !anonKey) {
    throw new Error(
      "Postgres backend still uses Supabase Auth — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const db: SupabaseClient = createSupabaseClient(url, anonKey);
  const session: ICurrentUserProvider = new SupabaseSessionProvider(db);
  const auth: IAuthService = new SupabaseAuthService(db);
  const adminProvisioner: IAdminUserProvisioner | null =
    url && config.supabaseServiceRoleKey
      ? new SupabaseAdminUserProvisioner(url, config.supabaseServiceRoleKey)
      : null;

  const pg = new PgRunner(getPgPool(databaseUrl), session);
  const blobRegistry = new PostgresBlobRegistry(pg);

  const settingsRepository: ISettingsRepository = new PostgresSettingsRepository(pg, session);
  const manageSettings = new ManageSettingsUseCaseClass({ repository: settingsRepository });
  const projectRepository: IProjectRepository = cacheRepo(
    new PostgresProjectRepository(pg, session),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "project" },
  );
  const dashboardLayoutRepository: IDashboardLayoutRepository = cacheRepo(
    new PostgresDashboardLayoutRepository(pg),
    ["get"],
    ["save"],
    pid,
    { resourceType: "dashboard_layout" },
  );
  const graphSettingsRepository: IGraphSettingsRepository = cacheRepo(
    new PostgresGraphSettingsRepository(pg),
    ["get"],
    ["save"],
    pid,
    { resourceType: "graph_settings" },
  );
  const integrationsStore: IIntegrationsStore = new PostgresIntegrationsStore(pg);
  const paperRepository: IPaperRepository = cacheRepo(
    new PostgresPaperRepository(pg, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "paper" },
  );

  const tagPaperCache = new Map<string, Promise<unknown>>();
  const tagPaperSettled = new Map<string, unknown>();
  const tagRepository: ITagRepository = cacheRepo(
    new PostgresTagRepository(pg, projectContext),
    ["getById", "findByName", "list", "listWithCounts"],
    ["save", "delete"],
    pid,
    { resourceType: "tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );
  const paperTagRepository: IPaperTagRepository = cacheRepo(
    new PostgresPaperTagRepository(pg),
    ["listForPaper", "listForTag", "listAll"],
    ["link", "unlink", "unlinkBySource", "reconcile"],
    pid,
    { resourceType: "paper_tag", sharedCache: tagPaperCache, sharedSettled: tagPaperSettled },
  );

  const logEntryRepository: ILogEntryRepository = cacheRepo(
    new PostgresLogEntryRepository(pg, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "log_entry" },
  );
  const reportSectionRepository: IReportSectionRepository = cacheRepo(
    new PostgresReportSectionRepository(pg, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "report_section" },
  );
  const rawVaultPageRepository = new PostgresVaultPageRepository(pg, projectContext);
  const readingListRepository: IReadingListRepository = cacheRepo(
    new PostgresReadingListRepository(pg, projectContext),
    ["getById", "list", "getTree"],
    ["save", "delete"],
    pid,
    { resourceType: "reading_list" },
  );
  const readingListItemRepository: IReadingListItemRepository = cacheRepo(
    new PostgresReadingListItemRepository(pg),
    ["listItems", "listItemsForLists", "listsForPaper", "find"],
    ["add", "remove"],
    pid,
    { resourceType: "reading_list_item" },
  );
  const paperRelationRepository: IPaperRelationRepository = cacheRepo(
    new PostgresPaperRelationRepository(pg, projectContext),
    ["getById", "list", "getGraph", "relationsFor", "findEdge"],
    ["save", "delete"],
    pid,
    { resourceType: "paper_relation" },
  );
  const experimentRepository: IExperimentRepository = cacheRepo(
    new PostgresExperimentRepository(pg, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "experiment" },
  );
  const metricRepository: IMetricRepository = new PostgresMetricRepository(pg);
  const shareRepository: IShareRepository = cacheRepo(
    new PostgresShareRepository(pg, session),
    ["listForResource", "listSharedWithMe"],
    ["grant", "revoke"],
    USER_SCOPE,
    { resourceType: "share" },
  );
  const commentRepository: ICommentRepository = new PostgresCommentRepository(pg);
  const sharedReader: ISharedReader = cacheRepo(
    new PostgresSharedReader(pg),
    ["read"],
    [],
    USER_SCOPE,
  );
  const milestoneRepository: IMilestoneRepository = cacheRepo(
    new PostgresMilestoneRepository(pg, projectContext),
    ["getById", "list"],
    ["save", "delete"],
    pid,
    { resourceType: "milestone" },
  );
  const memberRepository: IMemberRepository = new PostgresMemberRepository(pg, session);
  const supervisionRepository: ISupervisionRepository = new PostgresSupervisionRepository(pg);
  const projectBibliographyCollection: IProjectBibliographyCollectionStore =
    new PostgresProjectBibliographyCollectionStore(pg);

  const rawBlobStore = wireStorage({ blobRegistry, config: undefined });
  const libraryPinRepository: ILibraryPinRepository = cacheRepo(
    new PostgresLibraryPinRepository(pg, projectContext, session),
    ["listForProject", "isPinned"],
    ["pin", "unpin"],
    pid,
    { resourceType: "library_pin" },
  );
  const citationAlertTrackRepository: ICitationAlertTrackRepository = cacheRepo(
    new PostgresCitationAlertTrackRepository(pg, projectContext, session),
    ["listForProject", "getByPaperId"],
    ["track", "untrack", "save"],
    pid,
    { resourceType: "citation_alert_track" },
  );
  const annotationPinRepository: IAnnotationPinRepository = cacheRepo(
    new PostgresAnnotationPinRepository(pg, projectContext, session),
    ["listForProject", "listForPaper", "listForSection"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const annotationQuotationTypeRepository: IAnnotationQuotationTypeRepository = cacheRepo(
    new PostgresAnnotationQuotationTypeRepository(pg, projectContext, session),
    ["listForPaper"],
    ["save", "remove"],
    pid,
    { resourceType: "paper" },
  );
  const labSnapshotRepository: ILabSnapshotRepository = cacheRepo(
    new PostgresLabSnapshotRepository(pg, projectContext, session),
    ["listMine", "listForMember", "getById"],
    ["publish", "remove"],
    pid,
    { resourceType: "project" },
  );
  const paperFieldRepository: IPaperFieldRepository = cacheRepo(
    new PostgresPaperFieldRepository(pg, projectContext, session),
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
    paperFieldRepository,
  };
}
