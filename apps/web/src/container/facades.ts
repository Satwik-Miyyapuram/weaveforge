import type {
  AddLogEntryUseCase,
  AddPaperUseCase,
  AddRelationUseCase,
  CheckCitationAlertsUseCase,
  CreateMemberUseCase,
  Experiment,
  IBibliographyIntegration,
  ILogSyncIntegration,
  ILogEntryRepository,
  IMemberRepository,
  INotificationIntegration,
  ImportPaperUseCase,
  LinkCitationsUseCase,
  LogEntry,
  ManageCommentsUseCase,
  ManageExperimentUseCase,
  ManageMilestoneUseCase,
  ManageReadingListUseCase,
  ManageReportSectionUseCase,
  ManageSettingsUseCase,
  ManageSharingUseCase,
  ManageTagsUseCase,
  ManagePaperFieldsUseCase,
  Member,
  Milestone,
  Paper,
  PaperFieldKind,
  PaperFieldRollupAgg,
  PaperFieldValueData,
  PaperRelation,
  ReadingList,
  ReportSection,
  Share,
  UpdatePaperUseCase,
  PinSharedResourceUseCase,
  DuplicateSharedPaperUseCase,
  NewLibraryPinInput,
  LibraryPin,
  ReadingListItem,
  Tag,
  VaultPage,
  WorkspaceSnapshot,
} from "@weaveforge/core";
import { isStaleRunningExperiment, STALE_RUNNING_MS, collectWorkspaceSnapshot } from "@weaveforge/core";
import {
  AI_TOOL_NAMES,
  AiAccessPolicy,
  aiReadCategoryForResource,
  CreateAiSessionGrantUseCase,
  CreateAiProposalDraftUseCase,
  retrieveAiExcerpts,
  type AiAccessSettings,
  type AiActiveSession,
  type AiRetrievedExcerpt,
  type AiRetrievalDocument,
  type AiProposalKind,
  type AiResourceType,
  type AiWorkspaceSource,
  type AiToolName,
  ExecuteAiProposalUseCase,
  AiProposalExecutorRegistry,
  type AiWriteProposal,
  type IAiAuditStore,
  type IAiPaperNoteAppender,
  type IAiProposalStore,
} from "@weaveforge/core";
import type { IAuthService } from "@weaveforge/core";
import type { IDashboardLayoutRepository, DashboardLayout, IProjectBibliographyCollectionStore, IGraphSettingsRepository, GraphPersistedState } from "@weaveforge/core";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import type { LoadSharedWithMeScreenUseCase, LoadSharedWithMeScreenData } from "@/features/sharing/application/load-shared-with-me-screen.use-case";
import type { IIntegrationsStore, IGitClient } from "@/features/sync/domain/sync-ports";
import type { ISupervisionRepository } from "@weaveforge/core";
import type { IProjectRepository, Project } from "@weaveforge/core";
import type { ManageProjectUseCase } from "@weaveforge/core";
import type { PrefetchProjectUseCase } from "@/application/prefetch-project.use-case";
import type { ProjectContext } from "@/lib/project-context";
import type { DeletePaperUseCase } from "@/features/papers/application/delete-paper.use-case";
import type { LoadPapersScreenUseCase, PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import type { LoadExperimentsScreenUseCase, ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";
import type { LoadVaultScreenUseCase, VaultScreenData } from "@/features/vault/application/load-vault-screen.use-case";
import type { LoadReportScreenUseCase, ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { reportImagePathsInBody } from "@/features/report/lib/report-images-md";
import type { LoadPlanScreenUseCase, PlanScreenData as PlanScreenLoadData } from "@/features/plan/application/load-plan-screen.use-case";
import type {
  LoadReadingListsScreenUseCase,
  ReadingListsScreenData,
} from "@/features/reading-lists/application/load-reading-lists-screen.use-case";
import type { DuplicateSharedVaultPageUseCase } from "@/features/library/application/duplicate-shared-vault.use-case";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollabSnapshotHelpers, CollabSession } from "@/features/collab/application/collab-session";
import type { ICrdtUpdateStore, ICurrentUserProvider } from "@weaveforge/core";
import type { RemoveRelationUseCase } from "@weaveforge/core";
import type { IMetricRepository, MetricPoint } from "@weaveforge/core";
import type { IPaperImageStore } from "@/features/papers/domain/zotero";
import type { IntegrationsRegistry } from "@/integrations/registry";
import { applyBibliographyAnnotations } from "@/integrations/providers/zotero/bibliography-integration";
import { fetchSuperviseeMilestonesAndLogs } from "@/features/dashboard/application/fetch-supervisee-data";

export type { PapersScreenData };

export class PapersFacade {
  constructor(
    private readonly deps: {
      load: LoadPapersScreenUseCase;
      deletePaper: DeletePaperUseCase;
      bibliography: IBibliographyIntegration;
      papers: import("@weaveforge/core").IPaperRepository;
      manageTags: ManageTagsUseCase;
      updatePaper: UpdatePaperUseCase;
      importPaper: ImportPaperUseCase;
      addPaper: AddPaperUseCase;
      images: IPaperImageStore;
      citationAlerts: CheckCitationAlertsUseCase;
      annotationPins: import("@weaveforge/core").IAnnotationPinRepository;
      annotationQuotationTypes: import("@weaveforge/core").IAnnotationQuotationTypeRepository;
      readerAnnotations: import("@weaveforge/core").IReaderAnnotationSource &
        import("@weaveforge/core").IReaderAnnotationSink;
      /** Zotero API key + library, read at call time (post-unlock). */
      zoteroCredentials: import("@/features/papers/infrastructure/zotero-metadata-source").ZoteroCredentialsProvider;
      paperFields: ManagePaperFieldsUseCase;
      reportSections: import("@weaveforge/core").IReportSectionRepository;
    },
  ) {}

  loadScreenData() {
    return this.deps.load.execute();
  }

  async syncBibliography() {
    const library = await this.deps.bibliography.syncLibrary();
    const byPaper = await this.deps.bibliography.pullAnnotations();
    const annotations = await applyBibliographyAnnotations(
      byPaper,
      this.deps.papers,
      this.deps.manageTags,
    );
    return { library, annotations };
  }

  deletePaper(paper: Paper) {
    return this.deps.deletePaper.execute(paper);
  }

  async autoPush(paper: Paper) {
    if (paper.metadata?.zoteroKey) return;
    try {
      const key = await this.deps.bibliography.pushPaper(paper);
      if (key) {
        await this.deps.papers.save({ ...paper, metadata: { ...paper.metadata, zoteroKey: key } });
      }
    } catch {
      /* best-effort */
    }
  }

  getPaper(id: string) {
    return this.deps.papers.getById(id);
  }

  get updatePaper() {
    return this.deps.updatePaper;
  }
  get manageTags() {
    return this.deps.manageTags;
  }
  get importPaper() {
    return this.deps.importPaper;
  }
  get addPaper() {
    return this.deps.addPaper;
  }

  isCitationTracking(paperId: string) {
    return this.deps.citationAlerts.isTracking(paperId);
  }

  setCitationTracking(paperId: string, enabled: boolean) {
    return this.deps.citationAlerts.setTracking(paperId, enabled);
  }

  checkCitationAlerts(force = false) {
    return this.deps.citationAlerts.checkAll(force);
  }

  listAnnotationPinsForPaper(paperId: string) {
    return this.deps.annotationPins.listForPaper(paperId);
  }

  listAnnotationPinsForSection(sectionId: string) {
    return this.deps.annotationPins.listForSection(sectionId);
  }

  async setAnnotationPin(paperId: string, annotationKey: string, sectionId: string | null) {
    if (!sectionId) {
      await this.deps.annotationPins.remove(paperId, annotationKey);
      return null;
    }
    return this.deps.annotationPins.save({
      paperId,
      annotationKey,
      reportSectionId: sectionId,
    });
  }

  listAnnotationQuotationTypesForPaper(paperId: string) {
    return this.deps.annotationQuotationTypes.listForPaper(paperId);
  }

  async setAnnotationQuotationType(
    paperId: string,
    annotationKey: string,
    quotationType: import("@weaveforge/core").QuotationType | null,
  ) {
    if (!quotationType) {
      await this.deps.annotationQuotationTypes.remove(paperId, annotationKey);
      return null;
    }
    return this.deps.annotationQuotationTypes.save({
      paperId,
      annotationKey,
      quotationType,
    });
  }

  listReaderAnnotations(paperId: string) {
    return this.deps.readerAnnotations.list(paperId);
  }

  createReaderAnnotation(
    paperId: string,
    draft: import("@weaveforge/core").NewReaderAnnotation,
  ) {
    return this.deps.readerAnnotations.create(paperId, draft);
  }

  updateReaderAnnotation(
    id: string,
    patch: import("@weaveforge/core").ReaderAnnotationPatch,
  ) {
    return this.deps.readerAnnotations.update(id, patch);
  }

  removeReaderAnnotation(id: string) {
    return this.deps.readerAnnotations.remove(id);
  }

  /**
   * R5 dry-run: build Zotero write payloads without calling the live API.
   * Kept as a separate entry point so "show me what would happen" can never be
   * a mistyped argument away from actually writing.
   */
  async dryRunZoteroAnnotationWriteBack(paperId: string, parentItemKey: string) {
    const { DryRunZoteroAnnotationWriteBack } = await import("@weaveforge/core");
    const anns = await this.deps.readerAnnotations.list(paperId);
    const client = new DryRunZoteroAnnotationWriteBack();
    return client.push(parentItemKey, anns);
  }

  /**
   * R5 live push — writes this paper's local annotations into Zotero.
   *
   * `parentItemKey` is the **attachment** key (the stored PDF), not the
   * bibliographic item. Updates carry a version guard, so an annotation edited
   * in Zotero since the last sync returns `conflict` rather than being
   * overwritten. Callers must confirm with the user first; this mutates a real
   * library and nothing here asks twice.
   */
  async pushAnnotationsToZotero(paperId: string, parentItemKey: string) {
    const { ZoteroApiAnnotationWriteBack } = await import(
      "@/features/reader/infrastructure/zotero-annotation-write-back"
    );
    const anns = await this.deps.readerAnnotations.list(paperId);
    const local = anns.filter((a) => a.origin === "local");
    const client = new ZoteroApiAnnotationWriteBack(this.deps.zoteroCredentials);
    return client.push(parentItemKey, local, { live: true });
  }

  listReportSections() {
    return this.deps.reportSections.list();
  }

  listPaperFieldDefs() {
    return this.deps.paperFields.listDefs();
  }

  listPaperFieldValuesForPaper(paperId: string) {
    return this.deps.paperFields.listValuesForPaper(paperId);
  }

  listPaperFieldValuesForProject() {
    return this.deps.paperFields.listValuesForProject();
  }

  definePaperField(input: {
    name: string;
    kind: PaperFieldKind;
    options?: string[];
    rollup?: {
      relationFieldId: string;
      agg: PaperFieldRollupAgg;
      sourceFieldId?: string;
    };
  }) {
    return this.deps.paperFields.define(input);
  }

  renamePaperField(fieldId: string, name: string) {
    return this.deps.paperFields.rename(fieldId, name);
  }

  updatePaperFieldOptions(fieldId: string, options: string[]) {
    return this.deps.paperFields.updateOptions(fieldId, options);
  }

  removePaperField(fieldId: string) {
    return this.deps.paperFields.remove(fieldId);
  }

  setPaperFieldValue(
    paperId: string,
    fieldId: string,
    value: PaperFieldValueData | null,
  ) {
    return this.deps.paperFields.setValue(paperId, fieldId, value);
  }

  signedImageUrls(paths: string[]) {
    return this.deps.images.signedUrls(paths);
  }

  fetchImageBlob(path: string) {
    return this.deps.images.fetchDecrypted(path);
  }

  fetchImageBlobs(paths: readonly string[]) {
    const many = this.deps.images.fetchDecryptedMany;
    if (many) return many(paths);
    return Promise.all(paths.map((p) => this.deps.images.fetchDecrypted(p))).then((blobs) => {
      const out = new Map<string, Blob>();
      paths.forEach((p, i) => {
        if (blobs[i]) out.set(p, blobs[i]!);
      });
      return out;
    });
  }

  uploadImage(paperId: string, blob: Blob, ext: string) {
    return this.deps.images.upload(paperId, blob, ext);
  }

  removeImage(path: string) {
    return this.deps.images.remove(path);
  }
}

export interface GraphScreenData {
  papers: Paper[];
  notes: import("@weaveforge/core").VaultPage[];
  sections: ReportSection[];
  relations: PaperRelation[];
  lists: ReadingList[];
  membership: Map<string, Set<string>>;
}

export class GraphFacade {
  constructor(
    private readonly deps: {
      papers: import("@weaveforge/core").IPaperRepository;
      notes: import("@weaveforge/core").IVaultPageRepository;
      sections: import("@weaveforge/core").IReportSectionRepository;
      relations: import("@weaveforge/core").IPaperRelationRepository;
      lists: import("@weaveforge/core").IReadingListRepository;
      listItems: import("@weaveforge/core").IReadingListItemRepository;
      addRelation: AddRelationUseCase;
      linkCitations: LinkCitationsUseCase;
      removeRelation: RemoveRelationUseCase;
      manageTags: ManageTagsUseCase;
      tags: import("@weaveforge/core").ITagRepository;
      settings: IGraphSettingsRepository;
    },
  ) {}

  async loadScreenData(): Promise<GraphScreenData> {
    const [papers, notes, sections, relations, lists] = await Promise.all([
      this.deps.papers.list(),
      this.deps.notes.list(),
      this.deps.sections.list(),
      this.deps.relations.getGraph(),
      this.deps.lists.list(),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = new Map<string, Set<string>>(lists.map((l) => [l.id, new Set<string>()]));
    for (const it of items) {
      if (it.paperId) membership.get(it.listId)?.add(it.paperId);
    }
    return { papers, notes, sections, relations, lists, membership };
  }

  removeRelation(id: string) {
    return this.deps.removeRelation.execute(id);
  }

  get addRelation() {
    return this.deps.addRelation;
  }
  get linkCitations() {
    return this.deps.linkCitations;
  }
  get manageTags() {
    return this.deps.manageTags;
  }
  get tags() {
    return this.deps.tags;
  }

  getSettings(projectId: string) {
    return this.deps.settings.get(projectId);
  }

  saveSettings(projectId: string, state: GraphPersistedState) {
    return this.deps.settings.save(projectId, state);
  }
}

export type PlanScreenData = PlanScreenLoadData;

export class PlanFacade {
  constructor(
    private readonly deps: {
      load: LoadPlanScreenUseCase;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      manageMilestone: ManageMilestoneUseCase;
      notifications: INotificationIntegration;
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

  get manageMilestone() {
    return this.deps.manageMilestone;
  }
}

export class LogbookFacade {
  constructor(
    private readonly deps: {
      logEntries: ILogEntryRepository;
      addLogEntry: AddLogEntryUseCase;
      logSync: ILogSyncIntegration;
    },
  ) {}

  loadEntries() {
    return this.deps.logEntries.list();
  }

  get addLogEntry() {
    return this.deps.addLogEntry;
  }

  pushLog(entry: LogEntry) {
    return this.deps.logSync.pushLog(entry);
  }

  removeLog(entry: LogEntry) {
    return this.deps.logSync.removeLog(entry);
  }
}

export type { ReportScreenData };

export class ReportFacade {
  constructor(
    private readonly deps: {
      load: LoadReportScreenUseCase;
      sections: import("@weaveforge/core").IReportSectionRepository;
      manageReportSection: ManageReportSectionUseCase;
      images: import("@/features/report/infrastructure/report-image-store").ReportImageStore;
    },
  ) {}

  loadScreenData(): Promise<ReportScreenData> {
    return this.deps.load.execute();
  }

  getSection(id: string) {
    return this.deps.sections.getById(id);
  }

  get manageReportSection() {
    return this.deps.manageReportSection;
  }

  uploadImage(sectionId: string, blob: Blob, ext: string) {
    return this.deps.images.upload(sectionId, blob, ext);
  }

  fetchImageBlob(path: string) {
    return this.deps.images.fetchDecrypted(path);
  }

  fetchImageBlobs(paths: readonly string[]) {
    return this.deps.images.fetchDecryptedMany(paths);
  }

  /**
   * Delete a section and best-effort remove `reportimg:` blobs referenced in its notes
   * (same pattern as paper delete + metadata.images).
   */
  async removeSection(section: ReportSection): Promise<void> {
    const paths = reportImagePathsInBody(section.notes ?? "");
    await Promise.all(
      paths.map(async (path) => {
        try {
          await this.deps.images.remove(path);
        } catch {
          /* best-effort — row delete still proceeds */
        }
      }),
    );
    await this.deps.manageReportSection.remove(section.id);
  }
}

export class CollabFacade {
  constructor(
    private readonly inner: {
      crdtStore: ICrdtUpdateStore;
      crdtSnapshotStore: import("@/features/collab/infrastructure/crdt-snapshot-store").CrdtSnapshotStore;
      compactCrdtLog: import("@weaveforge/core").CompactCrdtLogUseCase;
      db: SupabaseClient;
      session: ICurrentUserProvider;
      projectId: () => string | null;
    },
  ) {}

  enabled() {
    return true;
  }

  collabDeps() {
    return this.inner;
  }

  collabSession(resourceType: string, resourceId: string): CollabSession {
    const snapshot = this.snapshotHelpers(resourceType, resourceId);
    return {
      crdtStore: this.inner.crdtStore,
      db: this.inner.db,
      projectId: this.inner.projectId,
      compactCrdtLog: snapshot.compactCrdtLog,
      getSnapshotUpto: snapshot.getSnapshotUpto,
      setSnapshotUpto: snapshot.setSnapshotUpto,
    };
  }

  snapshotHelpers(resourceType: string, resourceId: string): CollabSnapshotHelpers {
    const store = this.inner.crdtSnapshotStore;
    return {
      getSnapshotUpto: () => store.getSnapshotUpto(resourceType, resourceId),
      setSnapshotUpto: (uptoId: number) => store.setSnapshotUpto(resourceType, resourceId, uptoId),
      compactCrdtLog: this.inner.compactCrdtLog,
    };
  }

  requireUserId() {
    return this.inner.session.requireUserId();
  }
}

export class VaultFacade {
  constructor(
    private readonly deps: {
      load: LoadVaultScreenUseCase;
      pages: import("@weaveforge/core").IVaultPageRepository;
      manageVaultPage: import("@weaveforge/core").ManageVaultPageUseCase;
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
    return this.deps.assets.fetchDecrypted(path);
  }

  fetchAssetBlobs(paths: readonly string[]) {
    return this.deps.assets.fetchDecryptedMany(paths);
  }

  duplicateSharedPage(input: { resourceId: string; ownerId: string }) {
    return this.deps.duplicateSharedPage.execute(input);
  }
}

export class ExperimentsFacade {
  constructor(
    private readonly deps: {
      load: LoadExperimentsScreenUseCase;
      experiments: import("@weaveforge/core").IExperimentRepository;
      papers: import("@weaveforge/core").IPaperRepository;
      metrics: IMetricRepository;
      manageExperiment: ManageExperimentUseCase;
    },
  ) {}

  loadScreenData(): Promise<ExperimentsScreenData> {
    return this.reconcileAndLoad();
  }

  private async reconcileAndLoad(): Promise<ExperimentsScreenData> {
    const data = await this.deps.load.execute();
    const running = data.experiments.filter((e) => e.status === "running");
    const lastMetric = running.length
      ? await this.deps.metrics.latestActivityAt(running.map((e) => e.id))
      : new Map<string, number>();
    const stale = running.filter((e) =>
      isStaleRunningExperiment(e, Date.now(), STALE_RUNNING_MS, lastMetric.get(e.id)),
    );
    if (stale.length === 0) return data;

    const updated = await Promise.all(
      stale.map((e) =>
        this.deps.manageExperiment.setStatus(e.id, "abandoned").catch(() => null),
      ),
    );
    const byId = new Map(
      updated.filter((e): e is NonNullable<typeof e> => e != null).map((e) => [e.id, e]),
    );
    return {
      ...data,
      experiments: data.experiments.map((e) => byId.get(e.id) ?? e),
    };
  }

  getExperiment(id: string) {
    return this.deps.experiments.getById(id);
  }

  loadExperiments() {
    return this.deps.experiments.list();
  }

  getPaper(id: string) {
    return this.deps.papers.getById(id);
  }

  metricHistory(experimentId: string): Promise<MetricPoint[]> {
    return this.deps.metrics.history(experimentId);
  }

  get manageExperiment() {
    return this.deps.manageExperiment;
  }
}

export class DashboardFacade {
  constructor(
    private readonly deps: {
      layout: IDashboardLayoutRepository;
      prefetch: PrefetchProjectUseCase;
      projectId: () => string | null;
      papers: import("@weaveforge/core").IPaperRepository;
      sections: import("@weaveforge/core").IReportSectionRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      experiments: import("@weaveforge/core").IExperimentRepository;
      logEntries: ILogEntryRepository;
      relations: import("@weaveforge/core").IPaperRelationRepository;
      lists: import("@weaveforge/core").IReadingListRepository;
      tags: import("@weaveforge/core").ITagRepository;
      supervision: ISupervisionRepository;
    },
  ) {}

  getLayout(projectId: string) {
    return this.deps.layout.get(projectId);
  }

  saveLayout(projectId: string, layout: DashboardLayout) {
    return this.deps.layout.save(projectId, layout);
  }

  prefetch() {
    return this.deps.prefetch.execute();
  }

  statsPorts() {
    const supervision = this.deps.supervision;
    return {
      prefetch: () => this.deps.prefetch.execute(),
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

export class SettingsFacade {
  constructor(
    private readonly deps: {
      settings: ManageSettingsUseCase;
      bibliography: IBibliographyIntegration;
      projectBibliography: IProjectBibliographyCollectionStore;
      integrations: IIntegrationsStore;
    },
  ) {}

  get manageSettings() {
    return this.deps.settings;
  }
  get integrations() {
    return this.deps.integrations;
  }

  listBibliographyCollections() {
    return this.deps.bibliography.listCollections();
  }

  getProjectCollection(projectId: string) {
    return this.deps.projectBibliography.getCollection(projectId);
  }

  setProjectCollection(projectId: string, collection: string | null) {
    return this.deps.projectBibliography.setCollection(projectId, collection);
  }
}

export interface AiSourceOption extends AiWorkspaceSource {
  category: string;
}

interface StoredZoteroEntry {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  tags?: string[];
}

/** Browser-local grant manager. Sessions intentionally disappear on reload/sign-out. */
export class AiAssistantFacade {
  private readonly sessions = new Map<string, AiActiveSession>();
  private readonly createGrant = new CreateAiSessionGrantUseCase();
  private readonly policy = new AiAccessPolicy();
  private readonly createProposal: CreateAiProposalDraftUseCase;

  constructor(
    private readonly deps: {
      papers: import("@weaveforge/core").IPaperRepository;
      vaultPages: import("@weaveforge/core").IVaultPageRepository;
      readingLists: import("@weaveforge/core").IReadingListRepository;
      logEntries: ILogEntryRepository;
      experiments: import("@weaveforge/core").IExperimentRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      proposals: IAiProposalStore;
      isEncryptionUnlocked: () => boolean;
      newId: () => string;
      now: () => string;
      /** Deployment MCP allowlist; falls back to core AI_TOOL_NAMES when omitted. */
      allowedTools?: readonly AiToolName[];
    },
  ) {
    this.createProposal = new CreateAiProposalDraftUseCase({
      policy: this.policy, proposals: deps.proposals, clock: { nowIso: deps.now },
    });
  }

  async listSourceOptions(): Promise<readonly AiSourceOption[]> {
    const [papers, vaultPages, readingLists, logEntries, experiments, milestones] = await Promise.all([
      this.deps.papers.list(),
      this.deps.vaultPages.list(),
      this.deps.readingLists.list(),
      this.deps.logEntries.list(),
      this.deps.experiments.list(),
      this.deps.milestones.list(),
    ]);
    const source = (resourceType: AiResourceType, resourceId: string, label: string, category: string, href?: string): AiSourceOption => ({
      sourceId: `${resourceType}:${resourceId}`,
      resourceType,
      resourceId,
      label,
      category,
      href,
    });
    return [
      ...papers.map((paper) => source("paper", paper.id, paper.title, "Papers", `/papers?paper=${encodeURIComponent(paper.id)}`)),
      ...papers.filter((paper) => Boolean(paper.summary?.trim())).map((paper) =>
        source("paper_note", paper.id, `${paper.title} — paper note`, "Paper notes", `/papers?paper=${encodeURIComponent(paper.id)}#paper-note`)),
      ...papers.flatMap((paper) => this.zoteroEntries(paper).map((entry, index) =>
        source(
          entry.kind === "note" ? "zotero_note" : "zotero_annotation",
          this.zoteroResourceId(paper.id, entry, index),
          `${paper.title} — Zotero ${entry.kind === "note" ? "note" : "annotation"}`,
          "Zotero annotations and notes",
          `/papers?paper=${encodeURIComponent(paper.id)}#zotero-${encodeURIComponent(entry.key ?? `${entry.kind ?? "annotation"}-${index}`)}`,
        ))),
      ...readingLists.map((list) => source("reading_list", list.id, list.name, "Reading lists", `/lists?list=${encodeURIComponent(list.id)}`)),
      ...vaultPages.map((page) => source("vault_page", page.id, page.title, "Vault notes", `/notes?page=${encodeURIComponent(page.id)}`)),
      ...logEntries.map((entry) => source("log_entry", entry.id, `${entry.entryDate} ${entry.kind}`, "Logbook", `/log`)),
      ...experiments.map((experiment) => source("experiment", experiment.id, experiment.name, "Experiments", `/experiments?focus=${encodeURIComponent(experiment.id)}`)),
      ...milestones.map((milestone) => source("milestone", milestone.id, milestone.title, "Milestones", `/plan`)),
    ];
  }

  async startSession(input: {
    workspaceName: string;
    sourceIds: readonly string[];
    settings: AiAccessSettings;
    proposalCapabilities: readonly AiProposalKind[];
    ttlMinutes?: number;
  }): Promise<AiActiveSession> {
    const options = await this.listSourceOptions();
    const byId = new Map(options.map((option) => [option.sourceId, option]));
    const sources = input.sourceIds.map((sourceId) => {
      const source = byId.get(sourceId);
      if (!source) throw new Error("One or more selected sources are no longer available.");
      return source;
    });
    const session = this.createGrant.execute({
      id: this.deps.newId(),
      workspaceName: input.workspaceName,
      sources,
      settings: input.settings,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(),
      now: this.deps.now(),
      ttlMs: input.ttlMinutes == null ? undefined : input.ttlMinutes * 60_000,
      allowedTools: this.deps.allowedTools?.length ? this.deps.allowedTools : AI_TOOL_NAMES,
      proposalCapabilities: input.proposalCapabilities,
    });
    this.sessions.set(session.grant.id, session);
    return session;
  }

  /**
   * Repopulate the in-memory session Map from persisted grants after a reload.
   * Expired or (once locked) all grants are dropped by listActiveSessions.
   */
  restoreActiveSessions(sessions: readonly AiActiveSession[]): void {
    if (!this.deps.isEncryptionUnlocked()) return;
    const nowMs = Date.parse(this.deps.now());
    for (const session of sessions) {
      if (Date.parse(session.grant.expiresAt) > nowMs) this.sessions.set(session.grant.id, session);
    }
  }

  listActiveSessions(now = this.deps.now()): readonly AiActiveSession[] {
    if (!this.deps.isEncryptionUnlocked()) {
      this.sessions.clear();
      return [];
    }
    const nowMs = Date.parse(now);
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.grant.expiresAt) <= nowMs) this.sessions.delete(id);
    }
    return [...this.sessions.values()].sort((a, b) => a.grant.expiresAt.localeCompare(b.grant.expiresAt));
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  /**
   * Runs in the unlocked browser. The returned text is intentionally bounded
   * and is the only content a future MCP bridge may disclose to Codex.
   */
  async searchWorkspace(input: {
    sessionId: string;
    query: string;
    settings: AiAccessSettings;
    limit?: number;
  }): Promise<readonly AiRetrievedExcerpt[]> {
    const session = this.requireActiveSession(input.sessionId);
    const docs = await this.readGrantedDocuments(session, input.settings);
    return retrieveAiExcerpts(docs, input.query, { limit: input.limit });
  }

  async getSourceExcerpt(input: {
    sessionId: string;
    sourceId: string;
    settings: AiAccessSettings;
  }): Promise<AiRetrievalDocument | null> {
    const session = this.requireActiveSession(input.sessionId);
    const docs = await this.readGrantedDocuments(session, input.settings);
    const document = docs.find((candidate) => candidate.source.sourceId === input.sourceId);
    return document ? { ...document, text: boundedMcpExcerpt(document.text) } : null;
  }

  async getWorkspaceOutline(input: { sessionId: string; settings: AiAccessSettings }): Promise<readonly AiWorkspaceSource[]> {
    const session = this.requireActiveSession(input.sessionId);
    const readable = await this.readableSources(session, input.settings);
    const effectiveSession: AiActiveSession = { ...session, grant: { ...session.grant, readable } };
    for (const source of readable) {
      this.assertReadable(effectiveSession, input.settings, source);
    }
    return readable;
  }

  /** Persist a typed encrypted draft. This is the only live MCP proposal surface. */
  async proposeDraft(input: {
    sessionId: string; settings: AiAccessSettings; kind: AiProposalKind; tool: AiToolName;
    content: string; payload: Record<string, unknown>; resourceId?: string; resourceType?: AiResourceType;
    expectedRevision?: string; evidence?: readonly import("@weaveforge/core").AiEvidence[];
  }): Promise<{ status: "requires_review"; proposalId: string; kind: AiProposalKind; message: string }> {
    const session = this.requireActiveSession(input.sessionId);
    const proposal = await this.createProposal.execute({
      id: this.deps.newId(), kind: input.kind, tool: input.tool,
      resourceId: input.resourceId ?? this.deps.newId(), resourceType: input.resourceType,
      content: input.content, payload: input.payload, expectedRevision: input.expectedRevision,
      evidence: input.evidence, settings: input.settings, grant: session.grant,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(), now: this.deps.now(),
    });
    return { status: "requires_review", proposalId: proposal.id, kind: proposal.kind, message: "Draft saved securely. Review and approve it in WeaveForge before anything changes." };
  }

  /** Build and persist a review-only Zotero import. It never reads credentials. */
  async proposeZoteroImport(input: {
    sessionId: string; settings: AiAccessSettings; title: string; authors?: readonly string[];
    doi?: string; url?: string; year?: string | number; abstract?: string;
  }): Promise<{ status: "requires_review"; proposalId: string; kind: AiProposalKind; message: string }> {
    const title = input.title.trim();
    if (!title) throw new Error("A Zotero proposal needs a title.");
    const item = {
        itemType: "journalArticle", title,
        creators: (input.authors ?? []).map((name) => ({ name: name.trim(), creatorType: "author" })).filter((creator) => creator.name),
        DOI: input.doi?.trim() || undefined, url: input.url?.trim() || undefined,
        date: input.year == null ? undefined : String(input.year), abstractNote: input.abstract?.trim() || undefined,
    };
    return this.proposeDraft({ sessionId: input.sessionId, settings: input.settings, kind: "zotero_import", tool: "propose_zotero_import", content: `Import “${title}” into Zotero`, payload: { title, authors: input.authors ?? [], doi: input.doi, url: input.url, year: input.year, abstract: input.abstract, item } });
  }

  private requireActiveSession(sessionId: string): AiActiveSession {
    const session = this.sessions.get(sessionId);
    if (!session || !this.deps.isEncryptionUnlocked() || Date.parse(session.grant.expiresAt) <= Date.parse(this.deps.now())) {
      this.sessions.delete(sessionId);
      throw new Error("Open WeaveForge and unlock encryption to access this workspace.");
    }
    return session;
  }

  private assertReadable(session: AiActiveSession, settings: AiAccessSettings, source: AiWorkspaceSource): void {
    const decision = this.policy.evaluate({
      settings,
      grant: session.grant,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(),
      now: this.deps.now(),
      tool: "get_source_excerpt",
      resourceType: source.resourceType,
      resourceId: source.resourceId,
    });
    if (!decision.allowed) throw new Error(`AI source access denied: ${decision.reason}`);
  }

  private async readGrantedDocuments(session: AiActiveSession, settings: AiAccessSettings): Promise<readonly AiRetrievalDocument[]> {
    const [papers, vaultPages, readingLists, logEntries, experiments, milestones] = await Promise.all([
      this.deps.papers.list(), this.deps.vaultPages.list(), this.deps.readingLists.list(),
      this.deps.logEntries.list(), this.deps.experiments.list(), this.deps.milestones.list(),
    ]);
    const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((item) => [item.id, item]));
    const indexes = {
      papers: byId(papers), vaultPages: byId(vaultPages), readingLists: byId(readingLists),
      logEntries: byId(logEntries), experiments: byId(experiments), milestones: byId(milestones),
      zoteroEntries: new Map(papers.flatMap((paper) => this.zoteroEntries(paper).map((entry, index) =>
        [this.zoteroResourceId(paper.id, entry, index), { paper, entry }]))),
    };
    const readable = await this.readableSources(session, settings);
    const effectiveSession: AiActiveSession = { ...session, grant: { ...session.grant, readable } };
    return readable.flatMap((source) => {
      this.assertReadable(effectiveSession, settings, source);
      const text = this.sourceText(source, indexes);
      if (!text) return [];
      return [{ source: { ...source, label: source.label ?? source.sourceId }, text }];
    });
  }

  /** Re-evaluate auto-inclusion at request time; never add a disabled category. */
  private async readableSources(session: AiActiveSession, settings: AiAccessSettings): Promise<readonly AiWorkspaceSource[]> {
    const dynamicCategories = new Set(settings.autoIncludeNewSourceCategories ?? []);
    const sourceOptions = await this.listSourceOptions();
    return [
      ...session.grant.readable,
      ...sourceOptions.filter((source) => dynamicCategories.has(aiReadCategoryForResource(source.resourceType))
        && settings.readCategories.includes(aiReadCategoryForResource(source.resourceType))
        && !session.grant.readable.some((granted) => granted.sourceId === source.sourceId)),
    ];
  }

  private sourceText(
    source: AiWorkspaceSource,
    indexes: {
      papers: Map<string, import("@weaveforge/core").Paper>;
      vaultPages: Map<string, import("@weaveforge/core").VaultPage>;
      readingLists: Map<string, import("@weaveforge/core").ReadingList>;
      logEntries: Map<string, import("@weaveforge/core").LogEntry>;
      experiments: Map<string, import("@weaveforge/core").Experiment>;
      milestones: Map<string, import("@weaveforge/core").Milestone>;
      zoteroEntries: Map<string, { paper: import("@weaveforge/core").Paper; entry: StoredZoteroEntry }>;
    },
  ): string | null {
    const paper = indexes.papers.get(source.resourceId);
    if (source.resourceType === "paper" && paper) return [paper.title, paper.authors.join(", "), paper.year, paper.venue, paper.abstract, paper.status, paper.tags.join(" ")].filter(Boolean).join("\n");
    if (source.resourceType === "paper_note" && paper?.summary?.trim()) return paper.summary;
    const zotero = indexes.zoteroEntries.get(source.resourceId);
    if ((source.resourceType === "zotero_annotation" || source.resourceType === "zotero_note") && zotero) {
      return [zotero.paper.title, zotero.entry.text, zotero.entry.comment, zotero.entry.tags?.join(" ")].filter(Boolean).join("\n");
    }
    const list = indexes.readingLists.get(source.resourceId);
    if (source.resourceType === "reading_list" && list) return [list.name, list.description].filter(Boolean).join("\n");
    const vault = indexes.vaultPages.get(source.resourceId);
    if (source.resourceType === "vault_page" && vault) return [vault.title, vault.body].filter(Boolean).join("\n\n");
    const log = indexes.logEntries.get(source.resourceId);
    if (source.resourceType === "log_entry" && log) return `${log.entryDate} ${log.kind}\n${log.body}`;
    const experiment = indexes.experiments.get(source.resourceId);
    if (source.resourceType === "experiment" && experiment) return [experiment.name, experiment.hypothesis, experiment.status, experiment.resultNote, JSON.stringify(experiment.config), JSON.stringify(experiment.metrics)].filter(Boolean).join("\n");
    const milestone = indexes.milestones.get(source.resourceId);
    if (source.resourceType === "milestone" && milestone) return [milestone.title, milestone.description, milestone.status, milestone.targetDate, milestone.dependencies.map((item) => item.label ?? item.refId).filter(Boolean).join(", "), milestone.compute.map((item) => [item.resource, item.count, item.hours, item.notes].filter(Boolean).join(" ")).join("\n")].filter(Boolean).join("\n");
    return null;
  }

  private zoteroEntries(paper: import("@weaveforge/core").Paper): StoredZoteroEntry[] {
    const entries = paper.metadata?.["annotations"];
    return Array.isArray(entries) ? entries.filter((entry): entry is StoredZoteroEntry =>
      Boolean(entry) && typeof entry === "object" && (typeof entry.text === "string" || typeof entry.comment === "string"),
    ) : [];
  }

  private zoteroResourceId(paperId: string, entry: StoredZoteroEntry, index: number): string {
    return `${paperId}:${entry.key ?? `${entry.kind ?? "annotation"}-${index}`}`;
  }
}

/** MCP never receives an unbounded source body, even after explicit approval. */
function boundedMcpExcerpt(text: string, maxChars = 2_000): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Browser-only review boundary. MCP tools may draft proposals but cannot reach this facade. */
export class AiProposalFacade {
  private readonly executeProposal: ExecuteAiProposalUseCase;

  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: AiProposalExecutorRegistry;
    newId: () => string; now: () => string;
  }) {
    this.executeProposal = new ExecuteAiProposalUseCase({
      proposals: deps.proposals, audit: deps.audit, executors: deps.executors,
      ids: { newId: deps.newId }, clock: { nowIso: deps.now },
    });
  }

  listPending(): Promise<AiWriteProposal[]> { return this.deps.proposals.listPending(); }

  /**
   * Queue a draft the user asked for themselves, from inside the app.
   *
   * Deliberately not routed through `CreateAiProposalDraftUseCase`: that path
   * exists to gate an *external* agent acting over MCP, and evaluates a session
   * grant to decide whether that agent may touch a resource. Here the actor is
   * the signed-in user clicking a button in their own workspace, so there is no
   * third party to authorise — applying the grant check would mean refusing to
   * queue work the user explicitly requested.
   *
   * The write gate is unchanged: this only produces a pending row, and nothing
   * reaches a repository until it is approved in the review queue.
   */
  async draftLocal(input: {
    kind: AiProposalKind;
    resourceId: string;
    content: string;
    payload?: Record<string, unknown>;
    sourceLinks?: readonly string[];
    expectedRevision?: string;
  }): Promise<AiWriteProposal> {
    const content = input.content.trim();
    if (!content) throw new Error("A proposal needs a preview describing what it will do.");

    const proposal: AiWriteProposal = {
      id: this.deps.newId(),
      kind: input.kind,
      resourceId: input.resourceId,
      content,
      payload: input.payload,
      createdAt: this.deps.now(),
      status: "pending",
      sourceLinks: input.sourceLinks ?? [],
      expectedRevision: input.expectedRevision,
    };
    await this.deps.proposals.save(proposal);
    return proposal;
  }
  async pendingCount(): Promise<number> { return (await this.listPending()).length; }
  approve(id: string): Promise<"accepted" | "conflicted"> { return this.executeProposal.execute(id); }

  async reject(id: string): Promise<void> {
    const proposal = await this.deps.proposals.getById(id);
    if (!proposal) throw new Error("AI proposal not found");
    if (proposal.status !== "pending") throw new Error("AI proposal is no longer pending");
    await this.deps.proposals.save({ ...proposal, status: "rejected" });
    await this.deps.audit.save({ id: this.deps.newId(), proposalId: id, action: "rejected", createdAt: this.deps.now() });
  }

  async approveSafeBatch(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.approve(id);
  }
}

export class OrgFacade {
  constructor(
    private readonly deps: {
      members: IMemberRepository;
      createMember: CreateMemberUseCase;
      supervision: ISupervisionRepository;
      labSnapshots: import("@weaveforge/core").ILabSnapshotRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      logs: import("@weaveforge/core").ILogEntryRepository;
    },
  ) {}

  loadProfile() {
    return this.deps.members.getMine().catch(() => null);
  }

  loadTeam() {
    return this.deps.members.listTeam().catch(() => [] as Member[]);
  }

  loadLab() {
    return this.deps.members.listLab().catch(() => [] as Member[]);
  }

  listDirectory() {
    return this.deps.members.listDirectory();
  }

  get createMember() {
    return this.deps.createMember;
  }

  loadSupervisee(memberId: string) {
    return Promise.all([
      this.deps.supervision.listMilestones(memberId),
      this.deps.supervision.listLogs(memberId),
      this.deps.labSnapshots.listForMember(memberId),
    ]);
  }

  listMyLabSnapshots() {
    return this.deps.labSnapshots.listMine();
  }

  async publishLabSnapshot(input: { title: string; note?: string }) {
    const [milestones, logs] = await Promise.all([
      this.deps.milestones.list(),
      this.deps.logs.list(),
    ]);
    return this.deps.labSnapshots.publish({
      title: input.title,
      note: input.note,
      content: {
        milestones: milestones.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          status: m.status,
          targetDate: m.targetDate,
        })),
        logs: logs.map((l) => ({
          id: l.id,
          entryDate: l.entryDate,
          kind: l.kind,
          body: l.body,
        })),
      },
    });
  }

  removeLabSnapshot(id: string) {
    return this.deps.labSnapshots.remove(id);
  }
}

export class SharingFacade {
  constructor(
    private readonly deps: {
      sharing: ManageSharingUseCase;
      comments: ManageCommentsUseCase;
      createShareLink: import("@weaveforge/core").CreateShareLinkUseCase | null;
      redeemShareLink: import("@weaveforge/core").RedeemShareLinkUseCase | null;
      manageShareLinks: import("@weaveforge/core").ManageShareLinksUseCase | null;
      revokeShareLink: import("@weaveforge/core").RevokeShareLinkUseCase | null;
      session: ICurrentUserProvider;
      sharedReader: ISharedReader;
      members: IMemberRepository;
      pinShared: PinSharedResourceUseCase;
      duplicateSharedPaper: DuplicateSharedPaperUseCase;
      libraryPins: import("@weaveforge/core").ILibraryPinRepository;
      papers: import("@weaveforge/core").IPaperRepository;
      experiments: import("@weaveforge/core").IExperimentRepository;
      loadSharedWithMe: LoadSharedWithMeScreenUseCase;
    },
  ) {}

  shareLinksEnabled() {
    return this.deps.createShareLink != null;
  }

  async createShareLink(input: {
    resourceType: import("@weaveforge/core").ShareableType;
    resourceId: string;
    expiresAt?: string | null;
  }) {
    if (!this.deps.createShareLink) throw new Error("Share links require Supabase backend.");
    const ownerId = await this.deps.session.requireUserId();
    return this.deps.createShareLink.execute({ ownerId, ...input });
  }

  async redeemShareLink(urlToken: string) {
    if (!this.deps.redeemShareLink) throw new Error("Share links require Supabase backend.");
    return this.deps.redeemShareLink.execute(urlToken);
  }

  listShareLinks(resourceType: import("@weaveforge/core").ShareableType, resourceId: string) {
    if (!this.deps.manageShareLinks) return Promise.resolve([]);
    return this.deps.manageShareLinks.listForResource(resourceType, resourceId);
  }

  async revokeShareLink(input: { id: string; rotateDek?: boolean }) {
    if (!this.deps.revokeShareLink) throw new Error("Share links require Supabase backend.");
    const ownerId = await this.deps.session.requireUserId();
    return this.deps.revokeShareLink.execute({ ownerId, linkId: input.id, rotateDek: input.rotateDek });
  }

  get manageSharing() {
    return this.deps.sharing;
  }
  get manageComments() {
    return this.deps.comments;
  }
  get sharedReader() {
    return this.deps.sharedReader;
  }

  listDirectory() {
    return this.deps.members.listDirectory();
  }

  listSharedWithMe() {
    return this.deps.sharing.listSharedWithMe();
  }

  loadSharedWithMeScreen(): Promise<LoadSharedWithMeScreenData> {
    return this.deps.loadSharedWithMe.execute();
  }

  pinShared(input: NewLibraryPinInput): Promise<LibraryPin> {
    return this.deps.pinShared.execute(input);
  }

  duplicateSharedPaper(input: { resourceId: string; ownerId: string }) {
    return this.deps.duplicateSharedPaper.execute(input);
  }

  unpinShared(resourceType: import("@weaveforge/core").ShareableType, resourceId: string) {
    return this.deps.libraryPins.unpin(resourceType, resourceId);
  }

  isPinned(resourceType: import("@weaveforge/core").ShareableType, resourceId: string) {
    return this.deps.libraryPins.isPinned(resourceType, resourceId);
  }
}

export class ProjectsFacade {
  constructor(
    private readonly deps: {
      projects: IProjectRepository;
      manageProject: ManageProjectUseCase;
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

export class AuthFacade {
  constructor(private readonly deps: { auth: IAuthService }) {}

  get auth() {
    return this.deps.auth;
  }
}

export class SyncFacade {
  constructor(
    private readonly deps: {
      integrations: IIntegrationsStore;
      git: IGitClient;
      manageExperiment: ManageExperimentUseCase;
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
}

export type { ReadingListsScreenData };

export class ReadingListsFacade {
  constructor(
    private readonly deps: {
      load: LoadReadingListsScreenUseCase;
      lists: import("@weaveforge/core").IReadingListRepository;
      listItems: import("@weaveforge/core").IReadingListItemRepository;
      manageReadingList: ManageReadingListUseCase;
    },
  ) {}

  loadScreenData(): Promise<ReadingListsScreenData> {
    return this.deps.load.execute();
  }

  getList(id: string) {
    return this.deps.lists.getById(id);
  }

  listItems(listId: string) {
    return this.deps.listItems.listItems(listId);
  }

  listItemsForLists(listIds: readonly string[]) {
    return this.deps.listItems.listItemsForLists(listIds);
  }

  get manageReadingList() {
    return this.deps.manageReadingList;
  }
}

/**
 * One read of the whole project, for the consumers that need all of it: the
 * ZIP/folder serializer, the search indexer, and AI retrieval.
 *
 * It deliberately holds repositories rather than other facades. The screen
 * facades load *card projections* — `listSummaries()` drops note bodies
 * entirely (`body: ""`) and paper abstracts, bibtex, and metadata
 * (`PAPER_SUMMARY_COLUMNS`). Reading through them is what left the ZIP export
 * with empty notes and, because both note assets and paper images are
 * discovered by scanning those dropped fields, no attachments at all.
 */
export class WorkspaceFacade {
  constructor(
    private readonly deps: {
      papers: { list(): Promise<Paper[]> };
      vaultPages: { list(): Promise<VaultPage[]> };
      readingLists: { list(): Promise<ReadingList[]> };
      readingListItems: { listItemsForLists(ids: readonly string[]): Promise<ReadingListItem[]> };
      reportSections: { list(): Promise<ReportSection[]> };
      experiments: { list(): Promise<Experiment[]> };
      milestones: { list(): Promise<Milestone[]> };
      logEntries: { list(): Promise<LogEntry[]> };
      relations: { list(): Promise<PaperRelation[]> };
      tags: { list(): Promise<Tag[]> };
      readerAnnotations: { list(): Promise<import("@weaveforge/core").WorkspaceAnnotation[]> };
      /** Which project the baseline belongs to; a change invalidates it. */
      projectId(): string | null;
    },
  ) {}

  /**
   * The last snapshot, as the baseline for the next delta read.
   *
   * Held here rather than passed in by callers because there are four of them —
   * search, export, the folder mirror, the wiki — and every one wants the same
   * thing: current data, without re-downloading the bodies that did not change.
   */
  private previous: WorkspaceSnapshot | null = null;
  private previousProjectId: string | null = null;
  private inFlight: Promise<WorkspaceSnapshot> | null = null;

  /**
   * Read the project.
   *
   * Concurrent callers share one read: several screens mounting at once must
   * not each pull the workspace, and worse, must not each start from the same
   * stale baseline and race to replace it.
   */
  async snapshot(): Promise<WorkspaceSnapshot> {
    if (this.inFlight) return this.inFlight;

    // Checked here rather than left to a caller to remember: a delta read
    // merges into what it holds, so reusing one project's rows as another's
    // baseline would not be a stale cache, it would be the wrong project's
    // notes appearing in this one.
    const projectId = this.deps.projectId();
    if (projectId !== this.previousProjectId) this.previous = null;
    this.previousProjectId = projectId;

    this.inFlight = collectWorkspaceSnapshot(this.deps, undefined, this.previous ?? undefined)
      .then((snapshot) => {
        this.previous = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Drop the baseline, so the next read is a full one. */
  resetSnapshotBaseline(): void {
    this.previous = null;
  }
}

/** Swappable third-party integrations wired at the composition root. */
export type { IntegrationsRegistry } from "@/integrations/registry";

export interface AppContainer {
  integrations: IntegrationsRegistry;
  papers: PapersFacade;
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
  workspace: WorkspaceFacade;
  search: import("@/features/search/application/workspace-search").WorkspaceSearch;
  prefetchProject: PrefetchProjectUseCase;
  /** Active integration providers for this deployment (env-driven). */
  integrationConfig: import("@/integrations/config").IntegrationConfig;
  backendConfig: import("@/backend/config").BackendConfig;
}
