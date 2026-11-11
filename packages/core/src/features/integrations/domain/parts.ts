import type { LogEntry } from "../../logbook/domain/log-entry.js";
import type { Paper } from "../../papers/domain/paper.js";
import type { Milestone } from "../../plan/domain/milestone.js";
import type { CitationCandidate } from "../../relations/application/parts.js";

// --- integration-descriptors ---
/** UI-agnostic descriptor for a credential field on a user-scoped integration. */
export interface IntegrationFieldDescriptor {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder?: string;
}

/**
 * Describes a per-user integration shown in Settings (API keys, library ids, …).
 * Implementations map `fields[].id` to stored credentials via {@link getUserIntegrationField}.
 */
export interface UserIntegrationDescriptor {
  readonly providerId: string;
  readonly title: string;
  readonly description: string;
  readonly color: string;
  readonly fields: readonly IntegrationFieldDescriptor[];
  /**
   * When set, the provider is only offered if the deployment wires that runtime port.
   * Example: bibliography provider "zotero" when `config.bibliography === "zotero"`.
   */
  readonly runtimeGate?: {
    readonly kind: "bibliography" | "citation";
    readonly providerId: string;
  };
}

// --- integration-ports ---
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

/** What one annotation pull brings back. */
export interface BibliographyAnnotationPull {
  /** Provider paper key → its annotations and notes. */
  byPaper: Map<string, BibliographyAnnotation[]>;
  /**
   * Provider paper key → the key of the PDF attachment annotations hang off.
   *
   * Write-back needs it: Zotero anchors an annotation to the file it was drawn
   * on, not to the bibliographic item. Also the set of papers the pull covered,
   * so an empty `byPaper` entry for one of these means "none left", not
   * "not looked at".
   */
  attachments: Map<string, string>;
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
  pullAnnotations(): Promise<BibliographyAnnotationPull>;
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
  /** A log entry was just created (not edited). */
  notifyLogEntry(entry: LogEntry): Promise<void>;
}

export interface ILogSyncIntegration {
  readonly providerId: string;
  pushLog(entry: LogEntry): Promise<void>;
  removeLog(entry: LogEntry): Promise<void>;
}
