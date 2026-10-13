import type {
  IBibliographyIntegration,
  IPaperRepository,
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
  ManageTagsUseCase,
  PushPaperToZoteroUseCase,
} from "@weaveforge/core";
import {
  applyBibliographyAnnotations,
  ZOTERO_ATTACHMENT_KEY,
} from "@/integrations/providers/zotero/bibliography-integration";
import type {
  ZoteroAnnotationPusher,
  ZoteroAnnotationWriteBackSummary,
} from "@/features/reader/application/write-back-zotero-annotations";
import type { ImportLocalZoteroUseCase } from "@/features/papers/application/import-local-zotero.use-case";
import type { ZoteroCredentialsProvider } from "@/features/papers/infrastructure/zotero-metadata-source";

/**
 * Zotero: the cloud library, the copy running on this computer, and the
 * annotation write-back.
 *
 * Split out of `PapersFacade`. The five members share a collaborator set the
 * rest of that class has nothing to do with — the bibliography integration, the
 * credentials that are only readable after unlock, and the two use cases that
 * pull from a local install — and one of them writes to a real third-party
 * library, which is not a thing to find by scrolling past a card grid's methods.
 */
export class ZoteroFacade {
  constructor(
    private readonly deps: {
      bibliography: IBibliographyIntegration;
      /** The one push-to-Zotero rule, shared with the AI proposal executor. */
      pushToZotero: PushPaperToZoteroUseCase;
      /** The local-Zotero workflow, with the desktop bridge it needs injected. */
      importLocalZotero: ImportLocalZoteroUseCase;
      readerAnnotations: IReaderAnnotationSource & IReaderAnnotationSyncRecorder;
      /**
       * Read and written by `applyBibliographyAnnotations`, which matches pulled
       * annotations onto papers by key and reconciles each item's tags.
       */
      papers: IPaperRepository;
      manageTags: ManageTagsUseCase;
      /** Zotero API key + library, read at call time (post-unlock). */
      zoteroCredentials: ZoteroCredentialsProvider;
      /** Test seam for the live Zotero writer; defaults to the Web API client. */
      annotationPusher?: () => Promise<ZoteroAnnotationPusher>;
    },
  ) {}

  /**
   * The cloud library, with the API key the reader stored, both ways.
   *
   * Papers sync, then Zotero's annotations come in, then the ones made here
   * go out. The last step is what was missing: the pull worked, but nothing
   * called the write-back, so a highlight made in WeaveForge never reached
   * Zotero. Pressing Sync is the reader asking for exactly that, which is the
   * confirmation `pushAnnotationsToZotero` asks callers to get.
   */
  async syncBibliography() {
    const library = await this.deps.bibliography.syncLibrary();
    const pulled = await this.deps.bibliography.pullAnnotations();
    const annotations = await applyBibliographyAnnotations(
      pulled,
      this.deps.papers,
      this.deps.manageTags,
    );
    const writeBack = await this.writeBackAnnotations();
    return { library, annotations, writeBack };
  }

  /**
   * Every paper's owed local annotations, sent to its Zotero PDF.
   *
   * Skipped without a cloud API key: the Zotero on this computer answers reads
   * only, so there is nowhere to write.
   */
  private async writeBackAnnotations(): Promise<ZoteroAnnotationWriteBackSummary | null> {
    if (this.deps.bibliography.providerId !== "zotero") return null;
    const creds = await this.deps.zoteroCredentials();
    if (!creds.apiKey || !creds.library) return null;
    const { writeBackZoteroAnnotations } = await import(
      "@/features/reader/application/write-back-zotero-annotations"
    );
    const pusher = await (this.deps.annotationPusher ?? (() => this.defaultPusher()))();
    return writeBackZoteroAnnotations({
      papers: await this.deps.papers.list(),
      attachmentOf: (paper) => {
        const key = paper.metadata?.[ZOTERO_ATTACHMENT_KEY];
        return typeof key === "string" && key ? key : undefined;
      },
      annotations: this.deps.readerAnnotations,
      pusher,
    });
  }

  private async defaultPusher(): Promise<ZoteroAnnotationPusher> {
    const { ZoteroApiAnnotationWriteBack } = await import(
      "@/features/reader/infrastructure/zotero-annotation-write-back"
    );
    return new ZoteroApiAnnotationWriteBack(this.deps.zoteroCredentials);
  }

  /** The Zotero on this computer. See `ImportLocalZoteroUseCase`. */
  importLocalZotero() {
    return this.deps.importLocalZotero.execute();
  }

  /**
   * Push a freshly added paper to the bibliography manager.
   *
   * Best-effort, and the rule lives in core: the outcome is deliberately
   * ignored here — the paper is already saved, and this is a convenience.
   */
  async autoPush(paper: Parameters<PushPaperToZoteroUseCase["execute"]>[0]) {
    await this.deps.pushToZotero.execute(paper);
  }

  /**
   * R5 dry-run: build Zotero write payloads without calling the live API.
   * A separate entry point so "show me what would happen" can never be a
   * mistyped argument away from actually writing.
   */
  async dryRunZoteroAnnotationWriteBack(paperId: string, parentItemKey: string) {
    const { DryRunZoteroAnnotationWriteBack } = await import("@weaveforge/core");
    const annotations = await this.deps.readerAnnotations.list(paperId);
    return new DryRunZoteroAnnotationWriteBack().push(parentItemKey, annotations);
  }

  /**
   * R5 live push — writes this paper's **local** annotations into Zotero.
   *
   * `parentItemKey` is the *attachment* key (the stored PDF), not the
   * bibliographic item: annotations hang off the attachment. Updates carry a
   * version guard, so an annotation edited in Zotero since the last sync comes
   * back `conflict` rather than being overwritten. Callers must confirm with the
   * user first; this mutates a real library and nothing here asks twice.
   *
   * Only `local` annotations are sent — the ones this app created. An annotation
   * that came *from* Zotero is already there, and pushing it back is how a
   * round trip turns into a duplicate.
   */
  async pushAnnotationsToZotero(paperId: string, parentItemKey: string) {
    const { ZoteroApiAnnotationWriteBack } = await import(
      "@/features/reader/infrastructure/zotero-annotation-write-back"
    );
    const annotations = await this.deps.readerAnnotations.list(paperId);
    const local = annotations.filter((annotation) => annotation.origin === "local");
    const client = new ZoteroApiAnnotationWriteBack(this.deps.zoteroCredentials);
    // `live: true` is the whole difference between this and the dry run, and it
    // is a literal here rather than a parameter: a caller cannot opt into
    // writing by passing an argument, only by calling the method named for it.
    return client.push(parentItemKey, local, { live: true });
  }
}
