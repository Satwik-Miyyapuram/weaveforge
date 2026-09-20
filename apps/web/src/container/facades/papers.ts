import type {
  AddPaperUseCase,
  CheckCitationAlertsUseCase,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  ImportPaperUseCase,
  IPaperRepository,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReportSectionRepository,
  ManageTagsUseCase,
  NewReaderAnnotation,
  Paper,
  QuotationType,
  ReaderAnnotationPatch,
  UpdatePaperUseCase,
} from "@weaveforge/core";
import type { DeletePaperUseCase } from "@/features/papers/application/delete-paper.use-case";
import type { LoadPapersScreenUseCase, PapersScreenData } from "@/features/papers/application/load-papers-screen.use-case";
import type { IPaperImageStore } from "@/features/papers/domain/zotero";

/**
 * Papers: the shelf, the cards, the images, and the reader's annotations on them.
 *
 * It used to be four concerns in one class — 39 public members and 16
 * constructor dependencies, which is what the boundary gate now watches for.
 * Custom fields went to `PaperFieldsFacade` and everything Zotero to
 * `ZoteroFacade`; what remains is the paper itself and the things attached to
 * it. `signedImageUrls` was deleted rather than moved: no caller ever had one,
 * because the note and paper editors read blobs (`fetchImageBlobs`) instead of
 * presigned URLs.
 */
export class PapersFacade {
  constructor(
    private readonly deps: {
      load: LoadPapersScreenUseCase;
      deletePaper: DeletePaperUseCase;
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
      reportSections: IReportSectionRepository;
    },
  ) {}

  loadScreenData() {
    return this.deps.load.execute();
  }

  deletePaper(paper: Paper) {
    return this.deps.deletePaper.execute(paper);
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

  listReportSections() {
    return this.deps.reportSections.list();
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
