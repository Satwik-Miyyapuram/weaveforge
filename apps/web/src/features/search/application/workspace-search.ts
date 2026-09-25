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
  type IWorkspaceSearchIndex,
  type GraphDensity,
  type PdfIndexSource,
  type RelatedResult,
  type SearchDoc,
  type SearchHit,
  type SearchQueryOptions,
  type SearchSettings,
  type WikiGraph,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { applySearchSettings, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";
import type { SemanticIndex } from "./semantic-index";
import { idbGetSearchIndex, idbSetSearchIndex } from "../infrastructure/search-index-idb";
import { buildIndexInWorker, supportsIndexWorker } from "../infrastructure/index-builder";
import { persistSearchIndex } from "../infrastructure/index-cache-policy";
import { SearchIndexState } from "./search-index-state";
import { projectSearchDocuments } from "./search-projection";
import { pruneMissingPaperTexts } from "./pdf-text-pruning";
import { collapseToEntities } from "./collapse-to-entities";

/**
 * Owns the lifecycle of the workspace search index: build from a snapshot,
 * persist it, and rehydrate it on the next load.
 *
 * The index is a projection of the database, not of the optional folder mirror,
 * so search works for everyone regardless of whether the folder is enabled.
 *
 * What is left here is the lifecycle and the queries. The four things this class
 * also used to hold live beside it now: the projection
 * (`search-projection.ts`), the extracted-text pruning (`pdf-text-pruning.ts`),
 * the fields and their transitions (`search-index-state.ts`), and the
 * related-document helper (`collapse-to-entities.ts`).
 */
export class WorkspaceSearch {
  /**
   * The index and what it was built from.
   *
   * Gathered into one object because the invariant that matters is about their
   * relationship — a kind stays marked stale until a refresh that *read*
   * successfully has replaced its documents — and that invariant is now
   * testable without a snapshot, a worker or IndexedDB.
   */
  private readonly state = new SearchIndexState();
  private building: Promise<IWorkspaceSearchIndex> | null = null;
  private settings: SearchSettings | undefined;
  /** The optional semantic arm; null unless the user turned it on. */
  private semantic: SemanticIndex | null = null;

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
    return this.state.ready;
  }

  /**
   * Build or rehydrate the index. Concurrent callers share one build — every
   * screen mounting at once must not each tokenize the whole corpus.
   */
  async ensure(): Promise<IWorkspaceSearchIndex> {
    if (this.state.index) {
      await this.refreshStale();
      return this.state.index;
    }
    if (this.building) return this.building;

    this.building = this.build()
      .then((index) => {
        this.state.adopt(index, this.state.documentCount);
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
    this.state.graph = buildWikiGraph(snapshot);
    this.state.density = graphDensity(this.state.graph);

    const pruned = await pruneMissingPaperTexts(projectId, snapshot);
    this.state.pdfTexts = pruned.texts;
    this.state.pdfPageCounts = pruned.pageCounts;

    // Try the cache before building anything. Its revision has to match the
    // corpus, which means projecting to compute one — cheap next to the build,
    // and the check is what stops a stale index answering with deleted rows.
    const docs = this.projectDocuments(snapshot);
    const revision = searchRevision(docs);
    const cached = await idbGetSearchIndex(projectId);
    if (cached) {
      const restored = miniSearchIndexFactory.load(cached, revision);
      if (restored) {
        this.state.documentCount = docs.length;
        applySearchSettings(restored, this.settings);
        return restored;
      }
    }

    if (supportsIndexWorker()) {
      try {
        return await this.buildViaWorker(snapshot, projectId);
      } catch {
        // A worker that cannot start is not a reason to leave search broken;
        // the in-thread path below still works, it merely blocks.
      }
    }

    this.state.documentCount = docs.length;
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
  ): Promise<IWorkspaceSearchIndex> {
    const built = await buildIndexInWorker(snapshot, projectId, this.settings);
    const index = miniSearchIndexFactory.load(built.serialized, built.revision);
    if (!index) throw new Error("The built index could not be rehydrated.");

    applySearchSettings(index, this.settings);
    this.state.documentCount = built.documentCount;
    this.state.pdfPageCounts = new Map(built.pdfPageCounts);
    void persistSearchIndex(projectId, () => built.serialized, built.documentCount);
    return index;
  }

  /** Project the snapshot the same way the worker does. See `projectSearchDocuments`. */
  private projectDocuments(snapshot: WorkspaceSnapshot): SearchDoc[] {
    return projectSearchDocuments({
      snapshot,
      graph: this.state.graph,
      pdfTexts: this.state.pdfTexts,
    });
  }

  /**
   * A write happened; note which kinds it can have changed.
   *
   * The work happens on the next `ensure()`, which is what every screen calls
   * before it searches. An unmapped resource type distrusts the whole index —
   * see `SearchIndexState.markStale`.
   */
  markStale(resourceType: string | undefined): void {
    this.state.markStale(resourceType);
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
    const index = this.state.index;
    const kinds = this.state.pendingStale();
    if (!index || kinds.length === 0) return;

    const snapshot = await this.deps.snapshot();
    // Links change with notes and papers, so the graph is rebuilt whenever one
    // of those is stale — degrees are a ranking input for every kind.
    if (kinds.some((kind) => kind === "note" || kind === "paper")) {
      this.state.graph = buildWikiGraph(snapshot);
      this.state.density = graphDensity(this.state.graph);
    }
    const degrees = this.state.graph ? graphDegrees(this.state.graph) : new Map<string, number>();

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
    this.state.documentCount += fresh.length - before.length;

    // Last, and only the kinds actually refreshed — the whole point of the pair
    // of calls. See `SearchIndexState.settleStale`.
    this.state.settleStale(kinds);
  }

  /**
   * A stored document rebuilt as a hit, by `${kind}:${entityId}` id.
   *
   * What related-document lookup needs: it ranks ids, and the title and href a
   * result is rendered with live in the index. Searching for the id instead
   * finds nothing — an id is not text anyone wrote — and leaves the caller
   * showing a raw uuid.
   */
  hitById(id: string): SearchHit | null {
    return this.state.index?.hitById(id) ?? null;
  }

  /** Synchronous query; returns nothing until the index is ready. */
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[] {
    const index = this.state.index;
    return index ? index.search(query, options) : [];
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

  /**
   * The corpus as it stands now, for the semantic arm to embed.
   *
   * Projected on demand rather than kept from the build, which is a correctness
   * fix before it is a memory one. The kept copy went stale the moment anything
   * was refreshed — `refreshStale` and `indexPdf` add documents to the keyword
   * index and neither touched it — and the vector store's revision is derived
   * from this projection, so a stale copy produced a revision matching vectors
   * built from older text: a note added after the build could never be found by
   * the semantic arm, and nothing anywhere said so.
   *
   * Dropping the copy is what makes re-enabling work, too. The audit's patch
   * cleared it when the arm was switched off, which broke turning it back on:
   * `ensure()` returns the existing index without rebuilding, so there would
   * have been nothing left to embed and the arm would answer nothing.
   *
   * It is also a second copy of every note body and paper abstract, held for the
   * life of the tab, for a feature most readers never switch on.
   */
  async projectionForSemantic(): Promise<readonly SearchDoc[]> {
    const snapshot = await this.deps.snapshot();
    return this.projectDocuments(snapshot);
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
      const rebuilt = this.state.index?.hitById(hit.id);
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
    if (this.state.index) applySearchSettings(this.state.index, settings);
  }

  /**
   * Documents related to a seed. Tries graph expansion, then lexical
   * similarity, then shared tags — the arm is reported so the UI can explain a
   * thin result instead of leaving it puzzling.
   */
  related(seedId: string, limit = 8): RelatedResult[] {
    if (!this.state.graph || !this.state.index) return [];
    const index = this.state.index;
    return findRelated(seedId, {
      graph: this.state.graph,
      // More-like-this: search the seed's own title, which is the one piece of
      // its text available without holding the corpus in memory here. The id
      // is `kind:uuid`, so the title has to come from the index — searching
      // the uuid matched hex fragments of random PDF pages.
      lexical: (id, max) => {
        const seed = index.hitById(id);
        if (!seed) return [];
        return collapseToEntities(
          index.search(seed.title, { limit: max * 8 }),
          seed,
          (hit) => index.hitById(`paper:${hit.entityId}`)?.id ?? null,
        ).slice(0, max);
      },
    }, limit);
  }

  /** The link graph behind ranking and related-document lookup. */
  get wikiGraph(): WikiGraph | null {
    return this.state.graph;
  }

  /**
   * How connected the workspace is. Worth surfacing: on a sparse graph the
   * related-documents cascade falls back to lexical, and that is a fact about
   * the workspace rather than a bug.
   */
  get graphStats(): GraphDensity | null {
    return this.state.density;
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
    if (!this.state.index) return;

    const previous = this.state.pdfPageCounts.get(source.paperId) ?? 0;
    // Ids are generated for every page slot: pages too short to index were
    // never added, and removing an id that is not there is a no-op.
    this.state.index.remove(pdfDocIdsFor(source.paperId, Math.max(previous, source.pages.length)));

    const degrees = this.state.graph ? graphDegrees(this.state.graph) : undefined;
    const docs = toPdfSearchDocs([source], degrees);
    this.state.index.add(docs);
    this.state.pdfPageCounts.set(source.paperId, source.pages.length);
    // Recorded as well as indexed, so that a re-projection reproduces what the
    // index holds: without it, text indexed here would be missing from the
    // semantic arm's corpus until the next full build read it back from storage.
    this.state.pdfTexts = [...this.state.pdfTexts.filter((s) => s.paperId !== source.paperId), source];
    this.state.documentCount = this.state.documentCount - previous + docs.length;
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
    const documents = this.state.documentCount;
    return { documents, large: documents > LARGE_CORPUS_WARNING };
  }

  /** Drop the in-memory index so the next `ensure()` rebuilds it. */
  invalidate(): void {
    this.state.forget();
  }
}
