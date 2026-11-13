/**
 * The container, and the facades it is made of.
 *
 * One file per feature rather than one file of 1,600 lines: every facade here
 * is independent — none references another, and each is used only by the
 * `AppContainer` below — so the single file was a filing decision, not a
 * design one. This barrel keeps `@/container/facades` resolving as it did.
 */

import { isLocalMode, setLocalMode } from "@/backend/providers/local/local-identity";
import {
  fetchSuperviseeMilestonesAndLogs,
} from "@/features/dashboard/application/parts";
import type {
  DuplicateSharedVaultPageUseCase,
} from "@/features/library/application/duplicate-shared-vault.use-case";
import type {
  LoadPlanScreenUseCase,
  PlanScreenData as PlanScreenLoadData,
} from "@/features/plan/application/parts";
import type { PlanFeedLinks } from "@/features/plan/infrastructure/plan-feed-links";
import type {
  createReferenceActions,
  ReferenceLookupService,
  ResolvedReference,
} from "@/features/reader/application/parts-2";
import type { IGitClient, IIntegrationsStore, Integration } from "@/features/sync/domain/parts";
import type {
  LoadVaultScreenUseCase,
  VaultScreenData,
} from "@/features/vault/application/parts";
import type { ProjectContext } from "@/lib/parts-2";
import { readyCore } from "@/lib/rust-core";
import type {
  DashboardLayout,
  IAuthService,
  IDashboardLayoutRepository,
  IExperimentRepository,
  ILogEntryRepository,
  IMilestoneRepository,
  INotificationIntegration,
  IPaperRelationRepository,
  IPaperRepository,
  IProjectRepository,
  IReadingListRepository,
  IReportSectionRepository,
  ISupervisionRepository,
  ITagRepository,
  IVaultPageRepository,
  IExperimentManager,
  IProjectManager,
  IMilestoneManager,
  IVaultPageManager,
  Member,
  Milestone,
  ParsedReference,
} from "@weaveforge/core";
import { MattermostNotifier } from "../../features/sync/infrastructure/parts";

export * from "./papers";
export * from "./paper-fields";
export * from "./library-tidy";
export * from "./zotero";
export * from "./graph";
export * from "./logbook";
export * from "./report";
export * from "./collab";
export * from "./experiments";
export * from "./settings";
export * from "./ai-assistant";
export * from "./ai-proposals";
export * from "./org";
export * from "./sharing";
export * from "./reading-lists";
export * from "./workspace";
export * from "./ink";

import type { IntegrationsRegistry } from "@/integrations/parts";
import type { PrefetchProjectUseCase } from "@/application/prefetch-project.use-case";
import type { LibraryTidyFacade } from "./library-tidy";
import type { LogbookFacade } from "./logbook";
import type { OrgFacade } from "./org";
import type { PaperFieldsFacade } from "./paper-fields";
import type { PapersFacade } from "./papers";
import type { ReadingListsFacade } from "./reading-lists";
import type { ReportFacade } from "./report";
import type { SettingsFacade } from "./settings";
import type { SharingFacade } from "./sharing";
import type { WorkspaceFacade } from "./workspace";
import type { ZoteroFacade } from "./zotero";
import type { AiProposalFacade } from "./ai-proposals";
import type { CollabFacade } from "./collab";
import type { ExperimentsFacade } from "./experiments";
import type { GraphFacade } from "./graph";
import type { InkFacade } from "./ink";
import type { AiAssistantFacade } from "./ai-assistant";

export interface AppContainer {
  integrations: IntegrationsRegistry;
  papers: PapersFacade;
  /** Custom field definitions and values; split out of `PapersFacade`. */
  paperFields: PaperFieldsFacade;
  /** Placeholder titles and duplicate papers left by older imports. */
  libraryTidy: LibraryTidyFacade;
  /** The bibliography integration and the local-Zotero workflow. */
  zotero: ZoteroFacade;
  graph: GraphFacade;
  plan: PlanFacade;
  logbook: LogbookFacade;
  report: ReportFacade;
  vault: VaultFacade;
  experiments: ExperimentsFacade;
  dashboard: DashboardFacade;
  settings: SettingsFacade;
  aiAssistant: AiAssistantFacade;
  aiProposals: AiProposalFacade;
  org: OrgFacade;
  sharing: SharingFacade;
  projects: ProjectsFacade;
  auth: AuthFacade;
  collab: CollabFacade;
  sync: SyncFacade;
  readingLists: ReadingListsFacade;
  readerReferences: ReaderReferencesFacade;
  workspace: WorkspaceFacade;
  ink: InkFacade;
  search: import("@/features/search/application/workspace-search").WorkspaceSearch;
  prefetchProject: PrefetchProjectUseCase;
  /** Active integration providers for this deployment (env-driven). */
  integrationConfig: import("@/integrations/config").IntegrationConfig;
  backendConfig: import("@/backend/parts").BackendConfig;
}

// --- auth ---
export class AuthFacade {
  constructor(private readonly deps: { auth: IAuthService }) {}

  get auth() {
    return this.deps.auth;
  }

  /**
   * Whether this window is working on the computer rather than on an account.
   *
   * The answer lives in the local backend provider, which is the one module that
   * knows which wiring a window was built with. Presentation asking that
   * provider directly is how a screen ends up knowing which backend is behind
   * it — the whole point of the facade seam is that it does not have to. The
   * read is a `localStorage` lookup, so it stays synchronous.
   */
  isLocalMode(): boolean {
    return isLocalMode();
  }

  /**
   * Remember the choice. Reloading is still the caller's job: the wiring is
   * built once, so a flag flipped now only takes effect on the next load.
   */
  setLocalMode(on: boolean): void {
    setLocalMode(on);
  }
}

// --- dashboard ---
export class DashboardFacade {
  constructor(
    private readonly deps: {
      layout: IDashboardLayoutRepository;
      projectId: () => string | null;
      papers: IPaperRepository;
      sections: IReportSectionRepository;
      milestones: IMilestoneRepository;
      experiments: IExperimentRepository;
      logEntries: ILogEntryRepository;
      relations: IPaperRelationRepository;
      lists: IReadingListRepository;
      tags: ITagRepository;
      supervision: ISupervisionRepository;
    },
  ) {}

  getLayout(projectId: string) {
    return this.deps.layout.get(projectId);
  }

  saveLayout(projectId: string, layout: DashboardLayout) {
    return this.deps.layout.save(projectId, layout);
  }

  statsPorts() {
    const supervision = this.deps.supervision;
    return {
      listPapers: () => this.deps.papers.list(),
      listSections: () => this.deps.sections.list(),
      listMilestones: () =>
        this.deps.projectId() ? this.deps.milestones.list() : Promise.resolve([]),
      listExperiments: () => this.deps.experiments.list(),
      listLogEntries: () => this.deps.logEntries.list(),
      listRelations: () => this.deps.relations.getGraph(),
      getReadingListTree: () => this.deps.lists.getTree(),
      listTags: () => this.deps.tags.listWithCounts(),
      fetchSuperviseeData: (supervisees: readonly Member[]) =>
        fetchSuperviseeMilestonesAndLogs(supervision, supervisees),
    };
  }
}

// --- mattermost-test-post ---
/** Posts one test message per distinct channel the switched-on events route to. */
export async function postMattermostTest(integration: Integration): Promise<string[]> {
  const posts = readyCore().mattermostTestPosts(integration);
  const notifier = new MattermostNotifier();
  for (const p of posts) {
    await notifier.post(integration, p.message, p.channel);
  }
  return posts.map((p) => p.channel);
}

// --- plan ---
export type PlanScreenData = PlanScreenLoadData;

export class PlanFacade {
  constructor(
    private readonly deps: {
      load: LoadPlanScreenUseCase;
      milestones: IMilestoneRepository;
      manageMilestone: IMilestoneManager;
      notifications: INotificationIntegration;
      /** The calendar / widget link (Settings → Calendar). */
      feedLinks: PlanFeedLinks;
    },
  ) {}

  loadScreenData(): Promise<PlanScreenData> {
    return this.deps.load.execute();
  }

  getMilestone(id: string) {
    return this.deps.milestones.getById(id);
  }

  notifyMilestone(event: "added" | "status", milestone: Milestone) {
    return this.deps.notifications.notifyMilestone(event, milestone);
  }

  get feedLinks() {
    return this.deps.feedLinks;
  }

  get manageMilestone() {
    return this.deps.manageMilestone;
  }
}

// --- projects ---
export class ProjectsFacade {
  constructor(
    private readonly deps: {
      projects: IProjectRepository;
      manageProject: IProjectManager;
      context: ProjectContext;
      watchLww: (projectId: string | null) => void;
    },
  ) {}

  listProjects() {
    return this.deps.projects.list();
  }

  get manageProject() {
    return this.deps.manageProject;
  }
  get context() {
    return this.deps.context;
  }

  watchProject(projectId: string | null) {
    this.deps.watchLww(projectId);
  }
}

// --- reader-references ---
/**
 * What the reader's citation popover needs: a lookup that turns a parsed
 * bibliography entry into a record, and the actions the record offers.
 */
export class ReaderReferencesFacade {
  constructor(
    private readonly deps: {
      lookup: ReferenceLookupService;
      actions: ReturnType<typeof createReferenceActions>;
    },
  ) {}

  resolve(documentKey: string, entry: ParsedReference): Promise<ResolvedReference> {
    return this.deps.lookup.resolve(documentKey, entry);
  }

  get actions() {
    return this.deps.actions;
  }
}

// --- sync ---
export class SyncFacade {
  constructor(
    private readonly deps: {
      integrations: IIntegrationsStore;
      git: IGitClient;
      manageExperiment: IExperimentManager;
    },
  ) {}

  get integrations() {
    return this.deps.integrations;
  }
  get git() {
    return this.deps.git;
  }
  get manageExperiment() {
    return this.deps.manageExperiment;
  }

  /** Loaded on demand: the layout reaches this facade, the test post is settings-only. */
  async testMattermost(integration: Integration): Promise<string[]> {
    const { postMattermostTest } = await import("@/container/facades/index");
    return postMattermostTest(integration);
  }
}

// --- vault ---
export class VaultFacade {
  constructor(
    private readonly deps: {
      load: LoadVaultScreenUseCase;
      pages: IVaultPageRepository;
      manageVaultPage: IVaultPageManager;
      assets: import("@/features/vault/domain/vault-assets").IVaultAssetStore;
      duplicateSharedPage: DuplicateSharedVaultPageUseCase;
    },
  ) {}

  loadScreenData(): Promise<VaultScreenData> {
    return this.deps.load.execute();
  }

  getPage(id: string) {
    return this.deps.pages.getById(id);
  }

  listPages() {
    return this.deps.pages.list();
  }

  /** Every note's title, from the summary read (no bodies, lists or pins). */
  async pageTitles(): Promise<string[]> {
    return (await this.deps.pages.listSummaries()).map((page) => page.title);
  }

  get manageVaultPage() {
    return this.deps.manageVaultPage;
  }

  uploadAsset(pageId: string, blob: Blob, ext: string) {
    return this.deps.assets.upload(pageId, blob, ext);
  }

  signedAssetUrls(paths: string[]) {
    return this.deps.assets.signedUrls(paths);
  }

  fetchAssetBlob(path: string) {
    return this.deps.assets.fetchBlob(path);
  }

  fetchAssetBlobs(paths: readonly string[]) {
    return this.deps.assets.fetchBlobs(paths);
  }

  duplicateSharedPage(input: { resourceId: string; ownerId: string }) {
    return this.deps.duplicateSharedPage.execute(input);
  }
}
