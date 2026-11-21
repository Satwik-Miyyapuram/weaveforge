import type {
  Experiment,
  LogEntry,
  Milestone,
  Paper,
  PaperRelation,
  ReadingList,
  ReadingListItem,
  ReportSection,
  Tag,
  VaultPage,
  WorkspaceAnnotation,
  WorkspaceSnapshot,
} from "@weaveforge/core";
import { collectWorkspaceSnapshot } from "@weaveforge/core";
import { forgetSessionSeen } from "@/features/workspace/application/folder-session-seen";

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
      readerAnnotations: { list(): Promise<WorkspaceAnnotation[]> };
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
  private inFlightProjectId: string | null = null;

  /**
   * Read the project.
   *
   * Concurrent callers share one read: several screens mounting at once must
   * not each pull the workspace, and worse, must not each start from the same
   * stale baseline and race to replace it.
   */
  async snapshot(): Promise<WorkspaceSnapshot> {
    // Checked here rather than left to a caller to remember: a delta read
    // merges into what it holds, so reusing one project's rows as another's
    // baseline would not be a stale cache, it would be the wrong project's
    // notes appearing in this one.
    const projectId = this.deps.projectId();
    // F97-P2-21: share a read only with callers asking for the same project.
    if (this.inFlight && this.inFlightProjectId === projectId) return this.inFlight;
    if (projectId !== this.previousProjectId) this.previous = null;
    this.previousProjectId = projectId;

    const read: Promise<WorkspaceSnapshot> = collectWorkspaceSnapshot(this.deps, undefined, this.previous ?? undefined)
      .then((snapshot) => {
        // A read that finishes after a project switch is not the new project's baseline.
        if (this.previousProjectId === projectId) this.previous = snapshot;
        return snapshot;
      })
      .finally(() => {
        if (this.inFlight === read) this.inFlight = null;
      });
    this.inFlight = read;
    this.inFlightProjectId = projectId;
    return read;
  }

  /**
   * Drop the baseline, so the next read is a full one. The folder mirror's in-session
   * record goes too: the next mirror starts from nothing and rewrites no existing file.
   */
  resetSnapshotBaseline(): void {
    this.previous = null;
    forgetSessionSeen();
  }
}
