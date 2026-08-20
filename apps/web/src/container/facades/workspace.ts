import type {
  Experiment,
  LogEntry,
  Milestone,
  Paper,
  PaperRelation,
  ReadingList,
  ReportSection,
  ReadingListItem,
  Tag,
  VaultPage,
  WorkspaceSnapshot,
} from "@weaveforge/core";
import { collectWorkspaceSnapshot } from "@weaveforge/core";

/**
 * One read of the whole project, for the consumers that need all of it: the
 * ZIP/folder serializer, the search indexer, and AI retrieval.
 *
 * It deliberately holds repositories rather than other facades. The screen
 * facades load *card projections* — `listSummaries()` drops note bodies
 * entirely (`body: ""`) and paper abstracts, bibtex, and metadata
 * (`PAPER_SUMMARY_COLUMNS`). Reading through them is what left the ZIP export
 * with empty notes and, because both note assets and paper images are
 * discovered by scanning those dropped fields, no attachments at all.
 */
export class WorkspaceFacade {
  constructor(
    private readonly deps: {
      papers: { list(): Promise<Paper[]> };
      vaultPages: { list(): Promise<VaultPage[]> };
      readingLists: { list(): Promise<ReadingList[]> };
      readingListItems: { listItemsForLists(ids: readonly string[]): Promise<ReadingListItem[]> };
      reportSections: { list(): Promise<ReportSection[]> };
      experiments: { list(): Promise<Experiment[]> };
      milestones: { list(): Promise<Milestone[]> };
      logEntries: { list(): Promise<LogEntry[]> };
      relations: { list(): Promise<PaperRelation[]> };
      tags: { list(): Promise<Tag[]> };
      readerAnnotations: { list(): Promise<import("@weaveforge/core").WorkspaceAnnotation[]> };
      /** Which project the baseline belongs to; a change invalidates it. */
      projectId(): string | null;
    },
  ) {}

  /**
   * The last snapshot, as the baseline for the next delta read.
   *
   * Held here rather than passed in by callers because there are four of them —
   * search, export, the folder mirror, the wiki — and every one wants the same
   * thing: current data, without re-downloading the bodies that did not change.
   */
  private previous: WorkspaceSnapshot | null = null;
  private previousProjectId: string | null = null;
  private inFlight: Promise<WorkspaceSnapshot> | null = null;

  /**
   * Read the project.
   *
   * Concurrent callers share one read: several screens mounting at once must
   * not each pull the workspace, and worse, must not each start from the same
   * stale baseline and race to replace it.
   */
  async snapshot(): Promise<WorkspaceSnapshot> {
    if (this.inFlight) return this.inFlight;

    // Checked here rather than left to a caller to remember: a delta read
    // merges into what it holds, so reusing one project's rows as another's
    // baseline would not be a stale cache, it would be the wrong project's
    // notes appearing in this one.
    const projectId = this.deps.projectId();
    if (projectId !== this.previousProjectId) this.previous = null;
    this.previousProjectId = projectId;

    this.inFlight = collectWorkspaceSnapshot(this.deps, undefined, this.previous ?? undefined)
      .then((snapshot) => {
        this.previous = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Drop the baseline, so the next read is a full one. */
  resetSnapshotBaseline(): void {
    this.previous = null;
  }
}
