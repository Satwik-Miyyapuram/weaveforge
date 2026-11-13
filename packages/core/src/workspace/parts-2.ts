import type { Experiment } from "../features/experiments/domain/parts.js";
import type { LogEntry } from "../features/logbook/domain/parts.js";
import type { Paper } from "../features/papers/domain/parts.js";
import type { Milestone } from "../features/plan/domain/parts.js";
import type { ReadingList, ReadingListItem } from "../features/reading-lists/domain/parts.js";
import type { PaperRelation } from "../features/relations/domain/parts.js";
import type { ReportSection } from "../features/report/domain/parts.js";
import type { Tag } from "../features/tags/domain/parts.js";
import type { ReaderAnnotation } from "../reader/parts.js";
import type { VaultPage } from "../shared/core-contract.js";
import { rust } from "../shared/rust.js";
import type { GitAuthor } from "./parts-1.js";

// --- git-remote ---
/** Types for git-remote. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface GitRemoteConfig {
  /** An `https://` URL with no credentials in it. */
  url: string;
  /** Personal access token, sent as HTTP basic auth. Never logged or stored in the repo. */
  token?: string;
  /** The basic-auth user name sent with the token. Hosts that ignore it get `x-access-token`; Overleaf wants `git`. */
  username?: string;
}

export interface GitRemoteStatus {
  /** The URL of the sync remote, or null when no remote is connected. */
  url: string | null;
  branch: string;
  /** Local commits the remote does not have yet. */
  ahead: number;
  /** Remote commits not merged here yet (as of the last fetch). */
  behind: number;
}

export type GitPullResult =
  | { kind: "up-to-date" }
  | { kind: "fast-forward"; oid: string }
  | { kind: "merged"; oid: string }
  /** Nothing was changed locally; these files need resolving by hand. */
  | { kind: "conflict"; files: readonly string[] };

export type GitPushResult =
  | { kind: "pushed" }
  | { kind: "up-to-date" }
  /** The remote has commits this folder does not; pull first. */
  | { kind: "rejected"; reason: string };

export interface IWorkspaceGitRemote {
  /** Point the sync remote (`weaveforge`, never the user's own `origin`) at the URL (creating the repo when there is none) and fetch once to prove access. */
  connect(remote: GitRemoteConfig): Promise<GitRemoteStatus>;
  /** Fetches, then counts commits on each side. */
  remoteStatus(remote: GitRemoteConfig): Promise<GitRemoteStatus>;
  /** Commits local changes, fetches, then fast-forwards or merges. */
  pull(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPullResult>;
  /** Commits local changes, then pushes the branch. Never forces. */
  push(remote: GitRemoteConfig, author: GitAuthor): Promise<GitPushResult>;
}

/**
 * The remote branch every sync uses. The folder's checked-out branch is what is
 * pulled into and pushed from, whatever its local name (`master` on an older git).
 */
export const DEFAULT_SYNC_BRANCH = "main";

/** Who the commits made before a pull or push are by, when the user is not named. */
export const SYNC_AUTHOR: GitAuthor = { name: "WeaveForge", email: "sync@weaveforge.local" };

export type GitRemoteUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

// --- snapshot-delta ---
/**
 * Fetching only what changed.
 *
 * A snapshot reads every row of every entity, and for notes and papers those
 * rows carry bodies and abstracts — measured, 15 MB of JSON for a workspace of
 * 3 000 notes and 1 500 papers, downloaded again on every project load.
 *
 * The protocol here is two round trips instead of one, with the first being
 * tiny. Ask for ids and timestamps; compare against what is already held;
 * ask for the full rows of only the ones that differ.
 *
 * Deliberately not "give me everything changed since T". That cannot see a
 * deletion — a row that is gone reports nothing — so a snapshot built that way
 * accumulates entities the database no longer has, forever, and search answers
 * with them. Comparing the full id set costs one small query and is exact.
 */
export interface EntityStamp {
  id: string;
  /** Any value that changes when the row does; compared, never parsed. */
  updatedAt: string;
}

/**
 * A reader that can describe itself cheaply before being read in full.
 *
 * Both methods are optional: an entity small enough that listing it costs
 * nothing has no reason to implement them, and the caller falls back to `list`.
 */
export interface DeltaLister<T> {
  list(): Promise<T[]>;
  listStamps?(): Promise<EntityStamp[]>;
  listByIds?(ids: readonly string[]): Promise<T[]>;
}

export interface DeltaPlan {
  /** Ids whose rows have to be fetched — new or changed. */
  fetch: string[];
  /** Ids held locally that the database no longer has. */
  drop: string[];
  /** True when nothing changed and the held rows can be reused as they are. */
  unchanged: boolean;
}

/**
 * Read an entity, fetching only what changed when the reader supports it.
 *
 * `stampOf` says which field is the row's version. It is passed in rather than
 * assumed, because not every entity spells it `updatedAt` — some only have a
 * `createdAt`, and for an append-only entity that is exactly as good.
 */
export async function readWithDelta<T extends { id: string }>(
  reader: DeltaLister<T>,
  held: readonly T[] | undefined,
  stampOf: (row: T) => string,
): Promise<T[]> {
  // Nothing held, or a reader that cannot describe itself: one full read.
  if (!held || !reader.listStamps || !reader.listByIds) return reader.list();

  const remote = await reader.listStamps();
  const heldStamps = new Map(held.map((row) => [row.id, stampOf(row)]));
  const plan = rust().planDelta(remote, heldStamps);

  if (plan.unchanged) return rust().applyDelta(held, [], remote);

  // A change touching most of the corpus is cheaper as one read than as a
  // by-id fetch of nearly everything plus the stamp query already paid for.
  if (plan.fetch.length > remote.length * 0.6) return reader.list();

  const fetched = plan.fetch.length ? await reader.listByIds(plan.fetch) : [];
  return rust().applyDelta(held, fetched, remote);
}

// --- workspace-snapshot ---
/**
 * One read of everything in a project, for the three consumers that each used
 * to assemble their own: the folder/ZIP serializer, the search indexer, and AI
 * retrieval. Collecting it once keeps those three from drifting apart on which
 * entities exist and which fields count as content.
 *
 * Pure orchestration — no I/O of its own, no framework imports. Callers pass
 * the readers; the in-memory test repositories satisfy them as-is.
 */
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
