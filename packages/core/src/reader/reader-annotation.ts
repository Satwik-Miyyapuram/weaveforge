import type { WorkspaceAnnotation } from "../workspace/workspace-snapshot.js";
import type { CombinedPdfAnchor } from "./anchor-strategy.js";

/** Provenance of an annotation shown in the reader. */
export type AnnotationOrigin = "zotero" | "local";

/**
 * Zotero's complete annotation type set — see zotero/zotero annotations.js.
 * There is no `strikeout`. Local types must be a subset of this set (R3 rule).
 */
export type ReaderAnnotationType =
  | "highlight"
  | "underline"
  | "note"
  | "image"
  | "ink"
  | "text";

export const READER_ANNOTATION_TYPES: readonly ReaderAnnotationType[] = [
  "highlight",
  "underline",
  "note",
  "image",
  "ink",
  "text",
] as const;

export function isReaderAnnotationType(value: string): value is ReaderAnnotationType {
  return (READER_ANNOTATION_TYPES as readonly string[]).includes(value);
}

/** R5 write-back bookkeeping for a reader annotation row. */
export type AnnotationSyncState = "local" | "synced" | "pending" | "conflict";

const ANNOTATION_SYNC_STATES: readonly AnnotationSyncState[] = [
  "local",
  "synced",
  "pending",
  "conflict",
] as const;

export function isAnnotationSyncState(value: string): value is AnnotationSyncState {
  return (ANNOTATION_SYNC_STATES as readonly string[]).includes(value);
}

export interface ReaderAnnotation {
  id: string;
  origin: AnnotationOrigin;
  /** Zotero item key when origin === "zotero"; null for local-only. */
  zoteroKey: string | null;
  type: ReaderAnnotationType;
  color: string;
  /** Selected text (empty for ink/image). */
  text: string;
  comment: string;
  tags: string[];
  /** Rects for fidelity, locus for durability. Both, always when possible. */
  anchor: CombinedPdfAnchor;
  /** Zotero's ordering key, or a synthesised equivalent for local ones. */
  sortIndex: string;
  createdAt: string;
  updatedAt: string;
  /** R5 write-back bookkeeping — optional until sync touches the row. */
  syncState?: AnnotationSyncState;
  zoteroVersion?: number | null;
}

export interface NewReaderAnnotation {
  type: ReaderAnnotationType;
  color: string;
  text?: string;
  comment?: string;
  tags?: string[];
  anchor: CombinedPdfAnchor;
  sortIndex?: string;
  pageIndex: number;
}

export interface ReaderAnnotationPatch {
  color?: string;
  text?: string;
  comment?: string;
  tags?: string[];
  anchor?: CombinedPdfAnchor;
  sortIndex?: string;
}

/** Read port — R1 wires a source; creation affordances appear only when a sink exists. */
export interface IReaderAnnotationSource {
  list(paperId: string): Promise<ReaderAnnotation[]>;
}

/**
 * Project-wide read port.
 *
 * Separate from `IReaderAnnotationSource` because the two answer different
 * questions: the reader asks "what is on this paper" and already knows which
 * one, while the search index asks for everything and needs each row to say
 * where it came from. Folding both into one interface would force every reader
 * call site to carry a paper id it does not have.
 */
export interface IReaderAnnotationProjectSource {
  listForProject(): Promise<WorkspaceAnnotation[]>;
}

/** Write port — local-only in R3; Zotero-backed in R5. */
export interface IReaderAnnotationSink {
  create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation>;
  update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation>;
  remove(id: string): Promise<void>;
}
