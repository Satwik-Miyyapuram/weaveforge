import type {
  AddPaperUseCase,
  CheckCitationAlertsUseCase,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  IBibliographyIntegration,
  ImportPaperUseCase,
  IPaperRepository,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReportSectionRepository,
  ManagePaperFieldsUseCase,
  ManageTagsUseCase,
  NewReaderAnnotation,
  Paper,
  PaperFieldKind,
  PaperFieldRollupAgg,
  PaperFieldValueData,
  QuotationType,
  ReaderAnnotationPatch,
  PushPaperToZoteroUseCase,
  UpdatePaperUseCase,
} from "@weaveforge/core";
import type { DeletePaperUseCase } from "@/features/papers/application/delete-paper.use-case";
import type { LoadPapersScreenUseCase, PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import type { IPaperImageStore } from "@/features/papers/domain/zotero";
import { applyBibliographyAnnotations } from "@/integrations/providers/zotero/bibliography-integration";

export class PapersFacade {
  constructor(
    private readonly deps: {
      load: LoadPapersScreenUseCase;
      deletePaper: DeletePaperUseCase;
      bibliography: IBibliographyIntegration;
      /** The one push-to-Zotero rule, shared with the AI proposal executor. */
      pushToZotero: PushPaperToZoteroUseCase;
      papers: IPaperRepository;
      manageTags: ManageTagsUseCase;
      updatePaper: UpdatePaperUseCase;
      importPaper: ImportPaperUseCase;
      addPaper: AddPaperUseCase;
      images: IPaperImageStore;
      citationAlerts: CheckCitationAlertsUseCase;
      annotationPins: IAnnotationPinRepository;
      annotationQuotationTypes: IAnnotationQuotationTypeRepository;
      readerAnnotations: IReaderAnnotationSource &
        IReaderAnnotationSink;
      /** Zotero API key + library, read at call time (post-unlock). */
      zoteroCredentials: import("@/features/papers/infrastructure/zotero-metadata-source").ZoteroCredentialsProvider;
      paperFields: ManagePaperFieldsUseCase;
      reportSections: IReportSectionRepository;
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

  /**
   * The Zotero running on this computer: its papers, then their annotations.
   *
   * Separate from `syncBibliography`, which reads the cloud library with an
   * API key. This one needs no key and no account: Zotero 7 serves a read-only
   * copy of the same API on loopback, and the desktop shell is what reaches
   * it. Items not yet in the library become papers first — a copy with no
   * account has no other way to fill its shelf — and annotations are then
   * matched by the `zoteroKey` every pulled paper carries.
   */
  async importLocalZotero() {
    const { desktop } = await import("@/lib/desktop/desktop-bridge");
    const bridge = desktop();
    if (!bridge || typeof bridge.zoteroLocal !== "function") {
      throw new Error("Reading the local Zotero needs the WeaveForge desktop app.");
    }
    const { localZoteroAnnotations, localZoteroLibrary } = await import(
      "@/features/papers/infrastructure/zotero-local"
    );
    const papers = await localZoteroLibrary(bridge, {
      listPapers: () => this.deps.papers.list(),
      addPaper: (input) => this.deps.addPaper.addManual(input),
      onItemTags: async (paper, remote) => {
        const names = (remote.tags ?? []).map((t) => t.tag ?? "").filter(Boolean);
        if (names.length === 0) return;
        await this.deps.manageTags.reconcileSources(
          paper.id,
          names.map((name) => ({ name, source: "zotero_item" as const })),
          ["zotero_item"],
        );
      },
    }).pull();
    const byPaper = await localZoteroAnnotations(bridge).pullAll();
    const annotations = await applyBibliographyAnnotations(
      byPaper,
      this.deps.papers,
      this.deps.manageTags,
    );
    return { papers, annotations, items: byPaper.size };
  }

  deletePaper(paper: Paper) {
    return this.deps.deletePaper.execute(paper);
  }

  /**
   * Push a freshly added paper to the bibliography manager.
   *
   * Best-effort, and the rule lives in core now: it was written out here and
   * again as a callback in the composition root, and the two had drifted on what
   * a failure means. The outcome is deliberately ignored here — the paper is
   * already saved, and this is a convenience.
   */
  async autoPush(paper: Paper) {
    await this.deps.pushToZotero.execute(paper);
  }

  getPaper(id: string) {
    return this.deps.papers.getById(id);
  }

  /** Every paper in the project, read through the cached repository. */
  listPapers() {
    return this.deps.papers.list();
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
    quotationType: QuotationType | null,
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
    draft: NewReaderAnnotation,
  ) {
    return this.deps.readerAnnotations.create(paperId, draft);
  }

  updateReaderAnnotation(
    id: string,
    patch: ReaderAnnotationPatch,
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
    return this.deps.images.fetchBlob(path);
  }

  fetchImageBlobs(paths: readonly string[]) {
    // Called on the store, not as a detached function: the bucket store's
    // `fetchBlobs` reads `this.blobs`, and unbound it threw on every note with
    // two or more pictures. The store owns its own batching, so this is the
    // whole of it.
    return this.deps.images.fetchBlobs(paths);
  }

  uploadImage(paperId: string, blob: Blob, ext: string) {
    return this.deps.images.upload(paperId, blob, ext);
  }

  removeImage(path: string) {
    return this.deps.images.remove(path);
  }
}
