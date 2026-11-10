/**
 * Types for the R5 Zotero write-back. The logic (sync decisions, field diffs,
 * conflict merge, payloads) runs in Rust (`crates/wf-core/src/reader/zotero_sync.rs`).
 */

import type { ReaderAnnotation, ReaderAnnotationType, AnnotationSyncState } from "./reader-annotation.js";
import type { CombinedPdfAnchor } from "./anchor-shapes.js";

/** Per-library write-back mode. */
export type ZoteroLibrarySyncMode = "bidirectional" | "read_only" | "ignored";

export interface ZoteroAnnotationRemote {
  key: string;
  version: number;
  type: ReaderAnnotationType;
  color: string;
  text: string;
  comment: string;
  tags: string[];
  anchor: CombinedPdfAnchor;
  sortIndex: string;
  updatedAt: string;
}

type AnnotationConflictField =
  | "color"
  | "text"
  | "comment"
  | "tags"
  | "anchor"
  | "type"
  | "sortIndex";

export interface AnnotationFieldConflict {
  field: AnnotationConflictField;
  local: unknown;
  remote: unknown;
}

export type AnnotationSyncDecision =
  | { kind: "push"; reason: string }
  | { kind: "pull"; reason: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; fields: AnnotationFieldConflict[]; reason: string }
  | { kind: "skip"; reason: string };

export interface AnnotationSyncRow {
  local: ReaderAnnotation & {
    syncState: AnnotationSyncState;
    zoteroVersion: number | null;
  };
  remote: ZoteroAnnotationRemote | null;
}

export type ConflictResolveChoice = "keep_local" | "accept_remote" | "merge";

/**
 * One annotation as Zotero's write API takes it. `annotationText` is only set
 * for text-bearing types and is left out for every other type.
 */
export interface ZoteroAnnotationWritePayload {
  itemType: "annotation";
  parentItem: string;
  annotationType: ReaderAnnotationType;
  annotationText?: string;
  annotationComment: string;
  annotationColor: string;
  annotationSortIndex: string;
  annotationPosition: string;
  tags: { tag: string }[];
}

export interface IZoteroAnnotationWriteBack {
  /**
   * Dry-run by default. Live implementations must require an explicit
   * `{ live: true }` flag and human-supervised credentials.
   */
  push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<{ dryRun: boolean; payloads: ZoteroAnnotationWritePayload[] }>;
}
