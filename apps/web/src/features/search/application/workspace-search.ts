import {
  LARGE_CORPUS_WARNING,
  buildWikiGraph,
  findRelated,
  graphDegrees,
  graphDensity,
  pdfDocIdsFor,
  searchRevision,
  toPdfSearchDocs,
  toSearchDocs,
  type GraphDensity,
  type PdfIndexSource,
  type RelatedResult,
  type WikiGraph,
  type IWorkspaceSearchIndex,
  type SearchHit,
  type SearchQueryOptions,
  type SearchSettings,
  type WorkspaceSnapshot,
} from "@thesis/core";
import { applySearchSettings, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";
import { idbGetSearchIndex, idbSetSearchIndex } from "../infrastructure/search-index-idb";
import { loadPdfTexts, removePdfTexts } from "../infrastructure/pdf-text-store";

/**
 * Owns the lifecycle of the workspace search index: build from a snapshot,
 * persist it, and rehydrate it on the next load.
 *
 * The index is a projection of the database, not of the optional folder mirror,
 * so search works for everyone regardless of whether the folder is enabled.
 */
export class WorkspaceSearch {
  private index: IWorkspaceSearchIndex | null = null;
  private building: Promise<IWorkspaceSearchIndex> | null = null;
  private settings: SearchSettings | undefined;
  private graph: WikiGraph | null = null;
  private density: GraphDensity | null = null;
  private documentCount = 0;
  /** Pages held per paper, so a re-extraction knows what to retract. */
  private pdfPageCounts = new Map<string, number>();

  constructor(
    private readonly deps: {
      snapshot(): Promise<WorkspaceSnapshot>;
      projectId(): string | null;
      /**
       * Saved ranking preferences. Read lazily at build time rather than
       * pushed in at startup: settings live behind auth, and the container is
       * constructed before there is a session to read them with.
       */
      loadSettings?(): Promise<SearchSettings | undefined>;
    },
  ) {}

  get ready(): boolean {
    return this.index !== null;
  }

  /**
   * Build or rehydrate the index. Concurrent callers share one build — every
   * screen mounting at once must not each tokenize the whole corpus.
   */
  async ensure(): Promise<IWorkspaceSearchIndex> {
    if (this.index) return this.index;
    if (this.building) return this.building;

    this.building = this.build()
      .then((index) => {
        this.index = index;
        return index;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  private async build(): Promise<IWorkspaceSearchIndex> {
    const projectId = this.deps.projectId();

    // Without this, saved weights only took effect after the user revisited
    // settings and pressed save — a preference silently ignored on every fresh
    // load is worse than not offering it.
    if (this.settings === undefined && this.deps.loadSettings) {
      this.settings = await this.deps.loadSettings().catch(() => undefined);
    }
    const [snapshot, storedPdfTexts] = await Promise.all([
      this.deps.snapshot(),
      loadPdfTexts(projectId),
    ]);

    // Nothing deletes a paper's extracted text when the paper goes, so the
    // store outlives the library. Indexing those pages would answer searches
    // with hits that open a reader for a paper that is not there.
    const paperIds = new Set(snapshot.papers.map((paper) => paper.id));
    const pdfTexts = storedPdfTexts.filter((source) => paperIds.has(source.paperId));
    if (pdfTexts.length !== storedPdfTexts.length) {
      void removePdfTexts(
        projectId,
        storedPdfTexts.filter((source) => !paperIds.has(source.paperId)).map((s) => s.paperId),
      );
    }
    this.pdfPageCounts = new Map(pdfTexts.map((source) => [source.paperId, source.pages.length]));
    // Build the link graph first: its degrees are the primary document-level
    // ranking signal, so documents have to be projected with them already in
    // place rather than patched afterwards.
    this.graph = buildWikiGraph(snapshot);
    this.density = graphDensity(this.graph);
    const degrees = graphDegrees(this.graph);

    // PDF pages join the same index: they are just documents with a page
    // number, so filters, ranking, and excerpting all apply unchanged.
    const docs = [...toSearchDocs(snapshot, degrees), ...toPdfSearchDocs(pdfTexts, degrees)];
    this.documentCount = docs.length;
    const revision = searchRevision(docs);

    // A cached index is only trusted when its revision matches the corpus we
    // just read; otherwise it could still answer with deleted documents.
    const cached = await idbGetSearchIndex(projectId);
    if (cached) {
      const restored = miniSearchIndexFactory.load(cached, revision);
      if (restored) {
        applySearchSettings(restored, this.settings);
        return restored;
      }
    }

    const index = buildSearchIndex(docs, revision, this.settings);
    void idbSetSearchIndex(projectId, index.serialize());
    return index;
  }

  /** Synchronous query; returns nothing until the index is ready. */
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[] {
    return this.index ? this.index.search(query, options) : [];
  }

  /**
   * Apply ranking preferences. Scoring reads them per query, so this takes
   * effect immediately — retokenizing the corpus for a weight change would be
   * a rebuild the user has no reason to wait for.
   */
  setSettings(settings: SearchSettings | undefined): void {
    this.settings = settings;
    if (this.index) applySearchSettings(this.index, settings);
  }

  /**
   * Documents related to a seed. Tries graph expansion, then lexical
   * similarity, then shared tags — the arm is reported so the UI can explain a
   * thin result instead of leaving it puzzling.
   */
  related(seedId: string, limit = 8): RelatedResult[] {
    if (!this.graph || !this.index) return [];
    const index = this.index;
    return findRelated(seedId, {
      graph: this.graph,
      // More-like-this: search the seed's own title, which is the one piece of
      // its text available without holding the corpus in memory here.
      lexical: (id, max) => {
        const title = id.split(":").slice(1).join(":");
        return index
          .search(title, { limit: max + 1 })
          .filter((hit) => hit.id !== id)
          .map((hit) => ({ id: hit.id, score: hit.score }));
      },
    }, limit);
  }

  /** The link graph behind ranking and related-document lookup. */
  get wikiGraph(): WikiGraph | null {
    return this.graph;
  }

  /**
   * How connected the workspace is. Worth surfacing: on a sparse graph the
   * related-documents cascade falls back to lexical, and that is a fact about
   * the workspace rather than a bug.
   */
  get graphStats(): GraphDensity | null {
    return this.density;
  }

  /**
   * Fold a freshly extracted PDF into the live index.
   *
   * Opening a PDF extracts its pages for the in-document search bar anyway;
   * this makes that text findable straight away instead of on the next reload.
   * The paper's existing pages are retracted first, so a re-extraction replaces
   * rather than accumulates.
   *
   * The result is deliberately not written to the index cache. Its revision is
   * computed from the corpus a build read, and an incremental change no longer
   * matches it — the next build will read the same text from storage and
   * produce a cache entry that is honestly labelled.
   */
  indexPdf(source: PdfIndexSource): void {
    if (!this.index) return;

    const previous = this.pdfPageCounts.get(source.paperId) ?? 0;
    // Ids are generated for every page slot: pages too short to index were
    // never added, and removing an id that is not there is a no-op.
    this.index.remove(pdfDocIdsFor(source.paperId, Math.max(previous, source.pages.length)));

    const degrees = this.graph ? graphDegrees(this.graph) : undefined;
    const docs = toPdfSearchDocs([source], degrees);
    this.index.add(docs);
    this.pdfPageCounts.set(source.paperId, source.pages.length);
    this.documentCount = this.documentCount - previous + docs.length;
  }

  /**
   * How big the index is, and whether it is past the size a browser holds
   * comfortably.
   *
   * Surfaced rather than enforced. Silently truncating someone's corpus would
   * make search quietly wrong; telling them the index is large lets them decide
   * whether to stop indexing whole PDFs.
   */
  get corpusSize(): { documents: number; large: boolean } {
    return { documents: this.documentCount, large: this.documentCount > LARGE_CORPUS_WARNING };
  }

  /** Drop the in-memory index so the next `ensure()` rebuilds it. */
  invalidate(): void {
    this.index = null;
    this.graph = null;
    this.density = null;
    this.documentCount = 0;
    this.pdfPageCounts = new Map();
  }
}
