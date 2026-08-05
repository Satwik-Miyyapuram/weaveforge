import {
  searchRevision,
  toSearchDocs,
  type IWorkspaceSearchIndex,
  type SearchHit,
  type SearchQueryOptions,
  type SearchSettings,
  type WorkspaceSnapshot,
} from "@thesis/core";
import { applySearchSettings, buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";
import { idbGetSearchIndex, idbSetSearchIndex } from "../infrastructure/search-index-idb";

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

  constructor(
    private readonly deps: {
      snapshot(): Promise<WorkspaceSnapshot>;
      projectId(): string | null;
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
    const snapshot = await this.deps.snapshot();
    const docs = toSearchDocs(snapshot);
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

  /** Drop the in-memory index so the next `ensure()` rebuilds it. */
  invalidate(): void {
    this.index = null;
  }
}
