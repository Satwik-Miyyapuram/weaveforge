import {
  LARGE_CORPUS_WARNING,
  buildWikiGraph,
  fuseRankings,
  findRelated,
  graphDegrees,
  graphDensity,
  pdfDocIdsFor,
  searchRevision,
  toAnnotationSearchDocs,
  toPdfSearchDocs,
  toSearchDocs,
  type GraphDensity,
  type PdfIndexSource,
  type RelatedResult,
  type WikiGraph,
  type IWorkspaceSearchIndex,
  type SearchDoc,
  type SearchHit,
  type SearchKind,
  type SearchQueryOptions,
  type SearchSettings,
  type WorkspaceSnapshot,
} from "@thesis/core";
import { applySearchSettings, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";
import type { SemanticIndex } from "./semantic-index";
import { idbGetSearchIndex, idbSetSearchIndex } from "../infrastructure/search-index-idb";
import { loadPdfTexts, removePdfTexts } from "../infrastructure/pdf-text-store";
import { buildIndexInWorker, supportsIndexWorker } from "../infrastructure/index-builder";
import { persistSearchIndex } from "../infrastructure/index-cache-policy";

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
  /** Kinds whose documents no longer match the database. */
  private readonly stale = new Set<SearchKind>();
  /** The optional semantic arm; null unless the user turned it on. */
  private semantic: SemanticIndex | null = null;
  /** Pages held per paper, so a re-extraction knows what to retract. */
  private pdfPageCounts = new Map<string, number>();
  /** The projection the index was built from, kept for the semantic arm. */
  private docs: readonly SearchDoc[] = [];
  /** Extracted PDF text for the live papers, read once per build. */
  private pdfTexts: readonly import("@thesis/core").PdfIndexSource[] = [];

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
    if (this.index) {
      await this.refreshStale();
      return this.index;
    }
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

    const snapshot = await this.deps.snapshot();
    // The graph is needed on this side regardless: it drives the related-panel
    // cascade, not only ranking, and it is cheap next to tokenizing.
    this.graph = buildWikiGraph(snapshot);
    this.density = graphDensity(this.graph);

    await this.prunePdfTextForMissingPapers(projectId, snapshot);

    // Try the cache before building anything. Its revision has to match the
    // corpus, which means projecting to compute one — cheap next to the build,
    // and the check is what stops a stale index answering with deleted rows.
    const docs = this.projectDocuments(snapshot);
    const revision = searchRevision(docs);
    const cached = await idbGetSearchIndex(projectId);
    if (cached) {
      const restored = miniSearchIndexFactory.load(cached, revision);
      if (restored) {
        this.adoptProjection(docs);
        applySearchSettings(restored, this.settings);
        return restored;
      }
    }

    if (supportsIndexWorker()) {
      try {
        return await this.buildViaWorker(snapshot, projectId, docs, revision);
      } catch {
        // A worker that cannot start is not a reason to leave search broken;
        // the in-thread path below still works, it merely blocks.
      }
    }

    this.adoptProjection(docs);
    const index = buildSearchIndex(docs, revision, this.settings);
    void persistSearchIndex(projectId, () => index.serialize(), docs.length);
    return index;
  }

  /**
   * Build in a worker, then rehydrate here.
   *
   * Rehydrating a serialized index is 17–45× cheaper than tokenizing the corpus
   * to produce one — measured across 1 000 to 15 000 documents. That ratio is
   * why the split is worth the structured clone it costs: the main thread pays
   * the cheap half and the expensive half happens where nothing is waiting on it.
   */
  private async buildViaWorker(
    snapshot: WorkspaceSnapshot,
    projectId: string | null,
    fallbackDocs: readonly SearchDoc[],
    fallbackRevision: string,
  ): Promise<IWorkspaceSearchIndex> {
    const built = await buildIndexInWorker(snapshot, projectId, this.settings);
    const index = miniSearchIndexFactory.load(built.serialized, built.revision);
    if (!index) throw new Error("The built index could not be rehydrated.");

    applySearchSettings(index, this.settings);
    this.documentCount = built.documentCount;
    this.pdfPageCounts = new Map(built.pdfPageCounts);
    // The projection is kept for the semantic arm, which embeds the same text.
    // Its revision must match what the worker actually indexed.
    this.docs = built.revision === fallbackRevision ? fallbackDocs : [];
    void persistSearchIndex(projectId, () => built.serialized, built.documentCount);
    return index;
  }

  /** Project the snapshot the same way the worker does, for the cache check. */
  private projectDocuments(snapshot: WorkspaceSnapshot): SearchDoc[] {
    const degrees = this.graph ? graphDegrees(this.graph) : new Map<string, number>();
    const paperTitles = new Map(snapshot.papers.map((paper) => [paper.id, paper.title]));
    return [
      ...toSearchDocs(snapshot, degrees),
      ...toPdfSearchDocs(this.pdfTexts, degrees),
      ...toAnnotationSearchDocs(snapshot.readerAnnotations, paperTitles, degrees),
    ];
  }

  private adoptProjection(docs: readonly SearchDoc[]): void {
    this.docs = docs;
    this.documentCount = docs.length;
  }

  /**
   * Extracted text for papers that no longer exist.
   *
   * Nothing deletes it when a paper goes, so the store outlives the library and
   * would answer searches with hits that open a reader for a missing paper.
   */
  private async prunePdfTextForMissingPapers(
    projectId: string | null,
    snapshot: WorkspaceSnapshot,
  ): Promise<void> {
    const stored = await loadPdfTexts(projectId);
    const paperIds = new Set(snapshot.papers.map((paper) => paper.id));
    const live = stored.filter((source) => paperIds.has(source.paperId));
    this.pdfTexts = live;
    this.pdfPageCounts = new Map(live.map((source) => [source.paperId, source.pages.length]));

    const orphans = stored.filter((source) => !paperIds.has(source.paperId));
    if (orphans.length) await removePdfTexts(projectId, orphans.map((source) => source.paperId));
  }

  /**
   * A write happened; note which kinds it can have changed.
   *
   * Marking rather than rebuilding, for two reasons. A save should not pay for
   * re-tokenizing the corpus while the user waits, and a burst of writes — an
   * import, a bulk tag edit — should cost one refresh rather than one each.
   * The work happens on the next `ensure()`, which is what every screen calls
   * before it searches.
   */
  markStale(resourceType: string | undefined): void {
    if (!this.index) return;
    const kinds = KINDS_FOR_RESOURCE[resourceType ?? ""];
    if (!kinds) {
      // An unmapped write could have touched anything; the honest response is
      // to distrust the whole index rather than guess at a subset.
      this.invalidate();
      return;
    }
    for (const kind of kinds) this.stale.add(kind);
  }

  /**
   * Bring stale kinds back in line, leaving everything else alone.
   *
   * The snapshot read is not the cost it looks like: repository caches are
   * cleared per resource type on write, so only the repository that changed
   * actually goes to the network. What this avoids is the expensive half —
   * re-tokenizing PDF page text, which is most of the index and is untouched by
   * editing a note.
   */
  private async refreshStale(): Promise<void> {
    const index = this.index;
    if (!index || this.stale.size === 0) return;

    const kinds = [...this.stale];
    this.stale.clear();

    const snapshot = await this.deps.snapshot();
    // Links change with notes and papers, so the graph is rebuilt whenever one
    // of those is stale — degrees are a ranking input for every kind.
    if (kinds.some((kind) => kind === "note" || kind === "paper")) {
      this.graph = buildWikiGraph(snapshot);
      this.density = graphDensity(this.graph);
    }
    const degrees = this.graph ? graphDegrees(this.graph) : new Map<string, number>();

    const wanted = new Set(kinds);
    const fresh = [
      ...toSearchDocs(snapshot, degrees),
      ...toAnnotationSearchDocs(
        snapshot.readerAnnotations,
        new Map(snapshot.papers.map((paper) => [paper.id, paper.title])),
        degrees,
      ),
    ].filter((doc) => wanted.has(doc.kind));

    // Retract first: a note that was deleted has no fresh document to overwrite
    // it, and would otherwise keep answering queries.
    const before = index.idsOfKind(kinds);
    index.remove(before);
    index.add(fresh);
    this.documentCount += fresh.length - before.length;
  }

  /** Synchronous query; returns nothing until the index is ready. */
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[] {
    return this.index ? this.index.search(query, options) : [];
  }

  /**
   * Attach or detach the semantic arm.
   *
   * Passed in rather than constructed here: building one downloads a model, and
   * that is a decision for the settings screen to make and for this class to
   * merely use.
   */
  setSemanticIndex(semantic: SemanticIndex | null): void {
    this.semantic = semantic;
  }

  get semanticReady(): boolean {
    return this.semantic?.ready ?? false;
  }

  /** Every document currently indexed, for the semantic arm to embed. */
  indexedDocuments(): readonly SearchDoc[] {
    return this.docs;
  }

  /**
   * Keyword and semantic results, fused.
   *
   * Async because embedding the query is a forward pass through the encoder.
   * The synchronous `search` stays for callers that type into a palette on
   * every keystroke; this is for the ones that can await an answer.
   *
   * With no semantic arm this is the keyword ranking, unchanged — the fusion
   * has to be invisible when there is nothing to fuse, or turning the feature
   * off would quietly become a different product.
   */
  async searchHybrid(query: string, options: SearchQueryOptions = {}): Promise<readonly SearchHit[]> {
    const keyword = this.search(query, options);
    const semantic = this.semantic;
    if (!semantic?.ready) return keyword;

    let nearest: { id: string; score: number }[] = [];
    try {
      nearest = await semantic.search(query, options.limit ?? 30);
    } catch {
      // The encoder failing is not a reason to return nothing; the keyword arm
      // is the one that always works.
      return keyword;
    }

    // Semantic hits are ids; the stored fields live in the keyword index, so a
    // document it does not hold cannot be rendered and is dropped.
    const known = new Map(keyword.map((hit) => [hit.id, hit]));
    const vectorHits = nearest.flatMap((hit) => {
      const existing = known.get(hit.id);
      if (existing) return [existing];
      const rebuilt = this.index?.hitById(hit.id);
      return rebuilt ? [rebuilt] : [];
    });

    // Keyword first, so its excerpt is the one that survives fusion.
    return fuseRankings(
      [{ items: keyword }, { items: vectorHits }],
      (hit) => hit.id,
      { limit: options.limit ?? 30 },
    );
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
    this.stale.clear();
  }
}

/**
 * Which search kinds a write to a repository can change.
 *
 * Deliberately narrow. A note edit cannot change a milestone, and treating
 * every write as "rebuild everything" is what made adding one note cost the
 * whole corpus. Resource types absent here fall back to a full rebuild rather
 * than a guess — see `markStale`.
 *
 * `pdf` is in no entry: page documents are projected from extracted text, not
 * from a repository row, and are refreshed by `indexPdf` when a document is
 * read. Renaming a paper leaves its page documents showing the old title until
 * the next full build — a property of where that title is stored, not of this
 * map.
 */
const KINDS_FOR_RESOURCE: Record<string, readonly SearchKind[] | undefined> = {
  paper: ["paper", "annotation"],
  vault_page: ["note"],
  reading_list: ["list"],
  reading_list_item: [],
  report_section: ["section"],
  experiment: ["experiment"],
  milestone: ["milestone"],
  log_entry: ["log"],
  // Relations and tags change how documents rank, not what they say.
  paper_relation: ["paper", "note"],
  tag: ["paper"],
  paper_tag: ["paper"],
  // Writes that cannot affect any indexed field.
  comment: [],
  share: [],
  library_pin: [],
  citation_alert_track: [],
  dashboard_layout: [],
  graph_settings: [],
};
