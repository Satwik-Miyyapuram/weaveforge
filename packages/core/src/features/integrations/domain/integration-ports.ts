import type { LogEntry } from "../../logbook/domain/log-entry.js";
import type { Milestone } from "../../plan/domain/milestone.js";
import type { Paper } from "../../papers/domain/paper.js";
import type { CitationCandidate } from "../../relations/application/citation-source.js";

export interface BibliographyCollection {
  key: string;
  name: string;
}

export interface BibliographySyncResult {
  pushed: number;
  pulled: number;
  deletedLocal: number;
}

export interface BibliographyAnnotation {
  /** Stable provider item key for local reconciliation and AI source grants. */
  key?: string;
  /** A PDF annotation or a child note attached to a paper. */
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  /** PDF page label / number when the provider supplies it. */
  page?: string;
  tags: string[];
}

/**
 * Swappable bibliography / reference-manager integration (Zotero today; Mendeley, etc. later).
 * Implementations live in the app infrastructure layer; domain depends only on this port.
 */
/**
 * Credentials typed into the connection form but not yet saved, keyed by the
 * provider descriptor's field ids (`{ apiKey, library }` for Zotero).
 *
 * Listing collections used to read the *stored* settings, so the collection
 * picker in the connection dialog stayed empty until the credentials had been
 * saved and the dialog reopened — the form told you as much. Passing what the
 * user has already typed lets the list fill in while they are still looking at
 * it, and doubles as a check that the key works before it is stored.
 */
export type BibliographyCredentials = Readonly<Record<string, string>>;

export interface IBibliographyIntegration {
  readonly providerId: string;
  syncLibrary(): Promise<BibliographySyncResult>;
  pullAnnotations(): Promise<Map<string, BibliographyAnnotation[]>>;
  pushPaper(paper: Paper): Promise<string | undefined>;
  removeRemotePaper(remoteKey: string): Promise<void>;
  /** Uses `credentials` when given, else whatever is stored for the provider. */
  listCollections(credentials?: BibliographyCredentials): Promise<BibliographyCollection[]>;
}

/** Per-project bibliography folder/collection (provider-specific key stored opaquely). */
export interface IProjectBibliographyCollectionStore {
  getCollection(projectId: string): Promise<string | undefined>;
  setCollection(projectId: string, collectionKey: string | null): Promise<void>;
}

export interface INotificationIntegration {
  readonly providerId: string;
  notifyMilestone(event: "added" | "status", milestone: Milestone): Promise<void>;
  notifyCitationAlert(trackedPaper: Paper, citingPapers: CitationCandidate[]): Promise<void>;
}

export interface ILogSyncIntegration {
  readonly providerId: string;
  pushLog(entry: LogEntry): Promise<void>;
  removeLog(entry: LogEntry): Promise<void>;
}
