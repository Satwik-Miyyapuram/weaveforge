import type {
  AddPaperUseCase,
  CheckCitationAlertsUseCase,
  IBibliographyIntegration,
  ImportPaperUseCase,
  ManageTagsUseCase,
  ManagePaperFieldsUseCase,
  Paper,
  PaperFieldKind,
  PaperFieldRollupAgg,
  PaperFieldValueData,
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

export type { PapersScreenData };
