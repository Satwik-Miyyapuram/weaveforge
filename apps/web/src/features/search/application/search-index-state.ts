import type {
  GraphDensity,
  IWorkspaceSearchIndex,
  PdfIndexSource,
  SearchKind,
  WikiGraph,
} from "@weaveforge/core";

/**
 * Which search kinds a write to a repository can change.
 *
 * Deliberately narrow. A note edit cannot change a milestone, and treating every
 * write as "rebuild everything" is what made adding one note cost the whole
 * corpus. Resource types absent here fall back to a full rebuild rather than a
 * guess — see {@link SearchIndexState.markStale}.
 *
 * `pdf` is in no entry: page documents are projected from extracted text, not
 * from a repository row, and are refreshed by `indexPdf` when a document is
 * read. Renaming a paper leaves its page documents showing the old title until
 * the next full build — a property of where that title is stored, not of this
 * map.
 */
export const KINDS_FOR_RESOURCE: Record<string, readonly SearchKind[] | undefined> = {
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

/**
 * The state of a built index: the index itself, and what it was built from.
 *
 * These seven fields lived directly on `WorkspaceSearch` and were read and
 * written from nine methods, which is how the one real bug in that class stayed
 * invisible: `refreshStale` cleared the staleness set *before* awaiting the
 * snapshot, so a read that rejected lost the kinds for good — the index went on
 * serving the rows it had, nothing was marked stale any more, and no later
 * `ensure()` had any reason to look again.
 *
 * Gathering them here makes the invariant sayable: **a kind stays marked until a
 * refresh that read successfully has replaced its documents.** `pendingStale`
 * and `settleStale` are separate calls for exactly that reason, and
 * `SearchIndexState` is where the pair can be tested without a snapshot, a
 * worker, IndexedDB or MiniSearch.
 *
 * Deliberately not a general-purpose state machine: it is the fields, the
 * transitions that have invariants, and nothing else. `graph`, `density`,
 * `documentCount`, `pdfPageCounts` and `pdfTexts` are public because their
 * readers want a value, not a method.
 */
export class SearchIndexState {
  index: IWorkspaceSearchIndex | null = null;
  graph: WikiGraph | null = null;
  density: GraphDensity | null = null;
  /** Documents the index holds, for the size warning. */
  documentCount = 0;
  /** Pages held per paper, so a re-extraction knows what to retract. */
  pdfPageCounts = new Map<string, number>();
  /** Extracted PDF text for the live papers, read once per build. */
  pdfTexts: readonly PdfIndexSource[] = [];

  private readonly stale = new Set<SearchKind>();

  get ready(): boolean {
    return this.index !== null;
  }

  /** Adopt a built or rehydrated index. */
  adopt(index: IWorkspaceSearchIndex, documentCount: number): void {
    this.index = index;
    this.documentCount = documentCount;
  }

  /**
   * Note which kinds a write can have changed.
   *
   * Returns whether the whole index was distrusted, which is what an unmapped
   * resource type means — the caller has nothing left to refresh selectively.
   * Marking rather than rebuilding: a save should not pay for re-tokenizing the
   * corpus while the user waits, and a burst of writes should cost one refresh
   * rather than one each.
   */
  markStale(resourceType: string | undefined): boolean {
    if (!this.ready) return false;
    const kinds = KINDS_FOR_RESOURCE[resourceType ?? ""];
    if (!kinds) {
      this.forget();
      return true;
    }
    for (const kind of kinds) this.stale.add(kind);
    return false;
  }

  /** The kinds waiting to be refreshed. Taking does not clear them. */
  pendingStale(): SearchKind[] {
    return [...this.stale];
  }

  /**
   * Forget the kinds a completed refresh replaced.
   *
   * Called only after the snapshot was read and the index updated. Clearing up
   * front — where this used to happen — means a failed read loses them
   * permanently. Removing per kind rather than clearing the set also keeps a
   * write that lands *during* the refresh marked, so the next one picks it up.
   */
  settleStale(kinds: readonly SearchKind[]): void {
    for (const kind of kinds) this.stale.delete(kind);
  }

  /** Nothing is indexed any more; the next `ensure()` rebuilds from scratch. */
  forget(): void {
    this.index = null;
    this.graph = null;
    this.density = null;
    this.documentCount = 0;
    this.pdfPageCounts = new Map();
    this.stale.clear();
  }
}
