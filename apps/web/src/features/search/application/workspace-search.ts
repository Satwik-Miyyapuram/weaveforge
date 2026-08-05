import {
  searchRevision,
  toSearchDocs,
  type IWorkspaceSearchIndex,
  type SearchHit,
  type SearchQueryOptions,
  type WorkspaceSnapshot,
} from "@thesis/core";
import { buildSearchIndex, miniSearchIndexFactory } from "../infrastructure/minisearch-index";
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
      if (restored) return restored;
    }

    const index = buildSearchIndex(docs, revision);
    void idbSetSearchIndex(projectId, index.serialize());
    return index;
  }

  /** Synchronous query; returns nothing until the index is ready. */
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[] {
    return this.index ? this.index.search(query, options) : [];
  }

  /** Drop the in-memory index so the next `ensure()` rebuilds it. */
  invalidate(): void {
    this.index = null;
  }
}
