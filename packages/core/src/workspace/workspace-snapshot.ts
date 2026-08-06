/**
 * One read of everything in a project, for the three consumers that each used
 * to assemble their own: the folder/ZIP serializer, the search indexer, and AI
 * retrieval. Collecting it once keeps those three from drifting apart on which
 * entities exist and which fields count as content.
 *
 * Pure orchestration — no I/O of its own, no framework imports. Callers pass
 * the readers; the in-memory test repositories satisfy them as-is.
 */

import type { Paper } from "../features/papers/domain/paper.js";
import type { PaperRelation } from "../features/relations/domain/paper-relation.js";
import type { VaultPage } from "../features/vault/domain/vault-page.js";
import type { ReadingList, ReadingListItem } from "../features/reading-lists/domain/reading-list.js";
import type { ReportSection } from "../features/report/domain/report-section.js";
import type { Experiment } from "../features/experiments/domain/experiment.js";
import type { Milestone } from "../features/plan/domain/milestone.js";
import type { LogEntry } from "../features/logbook/domain/log-entry.js";
import type { Tag } from "../features/tags/domain/tag.js";
import type { ReaderAnnotation } from "../reader/reader-annotation.js";
import { readWithDelta, type DeltaLister } from "./snapshot-delta.js";

/**
 * Minimal structural reader. Deliberately not the full `IReadableRepository`:
 * a snapshot only ever lists, and narrowing the requirement here means test
 * doubles are a one-line object literal rather than a stubbed-out repository.
 */
export interface WorkspaceLister<T> {
  list(): Promise<T[]>;
}

/**
 * Vault pages are the one entity where the obvious reader is the wrong one.
 * `listSummaries()` returns rows with `body: ""` (see the web repository's
 * `toSummaryDomain`), which is correct for card lists and silently destructive
 * here — it is what made the ZIP export ship empty notes and, because asset
 * paths are parsed out of the body, no note images either. Snapshots take the
 * full-body reader; nothing in this module may call `listSummaries()`.
 */
export interface WorkspaceSnapshotReaders {
  /**
   * Notes and papers carry bodies and abstracts and are most of a snapshot's
   * bytes, so their readers may describe themselves first and be read by
   * delta. Everything else is small enough that one list is cheaper than two
   * round trips.
   */
  papers: DeltaLister<Paper>;
  /** MUST return full bodies. */
  vaultPages: DeltaLister<VaultPage>;
  readingLists: WorkspaceLister<ReadingList>;
  reportSections: WorkspaceLister<ReportSection>;
  experiments: WorkspaceLister<Experiment>;
  milestones: WorkspaceLister<Milestone>;
  logEntries: WorkspaceLister<LogEntry>;
  /** Optional: absent in deployments where the feature is switched off. */
  relations?: WorkspaceLister<PaperRelation>;
  tags?: WorkspaceLister<Tag>;
  readingListItems?: {
    listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]>;
  };
  /**
   * Optional: reader highlights and their comments, project-wide.
   *
   * Absent in deployments without the reader, and absent from the folder
   * mirror — an annotation is a position in a PDF, and a markdown file cannot
   * hold one. It is here because search needs it: a highlight's comment is
   * often the only place a thought was written down.
   */
  readerAnnotations?: WorkspaceLister<WorkspaceAnnotation>;
}

/**
 * A reader annotation with the context search needs.
 *
 * `paperId` and `pageIndex` are not on `ReaderAnnotation` — it is always read
 * for one paper at a time, so the caller already knows both. Reading every
 * annotation in a project loses that, so they travel with the row.
 */
export interface WorkspaceAnnotation extends ReaderAnnotation {
  paperId: string;
  pageIndex: number;
}

export interface WorkspaceSnapshot {
  papers: readonly Paper[];
  vaultPages: readonly VaultPage[];
  readingLists: readonly ReadingList[];
  readingListItems: readonly ReadingListItem[];
  reportSections: readonly ReportSection[];
  experiments: readonly Experiment[];
  milestones: readonly Milestone[];
  logEntries: readonly LogEntry[];
  relations: readonly PaperRelation[];
  tags: readonly Tag[];
  readerAnnotations: readonly WorkspaceAnnotation[];
  /** When the snapshot was taken; the serializer stamps it into the manifest. */
  collectedAt: string;
}

export interface WorkspaceSnapshotCounts {
  papers: number;
  notes: number;
  readingLists: number;
  reportSections: number;
  experiments: number;
  milestones: number;
  logEntries: number;
  relations: number;
  tags: number;
}

async function listOr<T>(reader: WorkspaceLister<T> | undefined): Promise<T[]> {
  return reader ? reader.list() : [];
}

/**
 * Read every entity in the active project. Readers are already project-scoped
 * by the composition root, so there is no project filter to apply here.
 */
export async function collectWorkspaceSnapshot(
  readers: WorkspaceSnapshotReaders,
  now: () => string = () => new Date().toISOString(),
  /**
   * The last snapshot, if there is one. Given it, the two heavy entities are
   * refreshed by delta instead of re-downloaded — see `snapshot-delta`.
   */
  previous?: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  const [
    papers,
    vaultPages,
    readingLists,
    reportSections,
    experiments,
    milestones,
    logEntries,
    relations,
    tags,
    readerAnnotations,
  ] = await Promise.all([
    readWithDelta(readers.papers, previous?.papers, (row) => row.updatedAt || row.createdAt),
    readWithDelta(readers.vaultPages, previous?.vaultPages, (row) => row.updatedAt || row.createdAt),
    readers.readingLists.list(),
    readers.reportSections.list(),
    readers.experiments.list(),
    readers.milestones.list(),
    readers.logEntries.list(),
    listOr(readers.relations),
    listOr(readers.tags),
    listOr(readers.readerAnnotations),
  ]);

  // Membership needs the list ids, so it cannot join the batch above.
  const readingListItems = readers.readingListItems
    ? await readers.readingListItems.listItemsForLists(readingLists.map((list) => list.id))
    : [];

  return {
    papers,
    vaultPages,
    readingLists,
    readingListItems,
    reportSections,
    experiments,
    milestones,
    logEntries,
    relations,
    tags,
    readerAnnotations,
    collectedAt: now(),
  };
}

export function workspaceSnapshotCounts(snapshot: WorkspaceSnapshot): WorkspaceSnapshotCounts {
  return {
    papers: snapshot.papers.length,
    notes: snapshot.vaultPages.length,
    readingLists: snapshot.readingLists.length,
    reportSections: snapshot.reportSections.length,
    experiments: snapshot.experiments.length,
    milestones: snapshot.milestones.length,
    logEntries: snapshot.logEntries.length,
    relations: snapshot.relations.length,
    tags: snapshot.tags.length,
  };
}
