/**
 * Zotero write-back decisions, field diffs, conflict merges and payloads (R5),
 * re-exported from index.ts. The dry-run and live push classes stay in packages/core.
 * Types come from ./bindings.ts; the sync mode and conflict choice unions are inline.
 */
import {
  decideAnnotationSync as rawDecideAnnotationSync,
  zoteroWriteBackAnnotations as rawZoteroWriteBackAnnotations,
  zoteroWriteBackMessage as rawZoteroWriteBackMessage,
} from "../pkg/wf_wasm.js";
import type {
  ZoteroAnnotationDecision,
  ZoteroAnnotationLocal,
  ZoteroAnnotationSyncRow,
} from "./bindings.js";

export {
  diffAnnotationFields,
  isZoteroLibrarySyncMode,
  resolveAnnotationConflict,
  toZoteroWritePayload,
} from "../pkg/wf_wasm.js";

/**
 * What a sync should do with one annotation (Rust `decide_annotation_sync`).
 * Unknown modes act as `bidirectional`.
 */
export function decideAnnotationSync(
  row: ZoteroAnnotationSyncRow,
  mode: "bidirectional" | "read_only" | "ignored" | undefined,
): ZoteroAnnotationDecision {
  // A missing mode acts as `bidirectional` in TS; "" does the same in Rust.
  return rawDecideAnnotationSync(row, mode ?? "") as ZoteroAnnotationDecision;
}

/**
 * The annotations a write-back sends: everything but ink, and only those with a
 * PDF page (Rust `zotero_write_back_annotations`).
 */
export function zoteroWriteBackAnnotations<T extends ZoteroAnnotationLocal>(
  annotations: readonly T[],
): T[] {
  const kept = rawZoteroWriteBackAnnotations(annotations) as number[];
  return kept.map((index) => annotations[index]!);
}

/** A write-back run's counts (TS `ZoteroAnnotationWriteBackSummary`). */
export interface ZoteroWriteBackSummary {
  created: number;
  updated: number;
  conflicts: number;
  failed: number;
  /** The first failure's reason. */
  firstError?: string;
}

/**
 * The write-back's part of the sync line, led by its separator, or "" when nothing
 * was owed or there is no summary (Rust `zotero_write_back_message`).
 */
export function zoteroWriteBackMessage(summary: ZoteroWriteBackSummary | null): string {
  return rawZoteroWriteBackMessage(summary);
}
