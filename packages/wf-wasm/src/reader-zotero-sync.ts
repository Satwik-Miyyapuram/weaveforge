/**
 * Zotero write-back decisions, field diffs, conflict merges and payloads (R5),
 * re-exported from index.ts. The dry-run and live push classes stay in packages/core.
 * Types come from ./bindings.ts; the sync mode and conflict choice unions are inline.
 */
import {
  isZoteroLibrarySyncMode as rawIsZoteroLibrarySyncMode,
  decideAnnotationSync as rawDecideAnnotationSync,
  diffAnnotationFields as rawDiffAnnotationFields,
  resolveAnnotationConflict as rawResolveAnnotationConflict,
  toZoteroWritePayload as rawToZoteroWritePayload,
  zoteroWriteBackAnnotations as rawZoteroWriteBackAnnotations,
} from "../pkg/wf_wasm.js";
import type {
  ZoteroAnnotationDecision,
  ZoteroAnnotationFieldConflict,
  ZoteroAnnotationLocal,
  ZoteroAnnotationSyncRow,
  ZoteroAnnotationWritePayload,
} from "./bindings.js";

/** Whether `value` is a library sync mode (Rust `is_zotero_library_sync_mode`). */
export function isZoteroLibrarySyncMode(
  value: string,
): value is "bidirectional" | "read_only" | "ignored" {
  return rawIsZoteroLibrarySyncMode(value);
}

/**
 * What a sync should do with one annotation (Rust `decide_annotation_sync`).
 * Unknown modes act as `bidirectional`.
 */
export function decideAnnotationSync(
  row: ZoteroAnnotationSyncRow,
  mode: "bidirectional" | "read_only" | "ignored",
): ZoteroAnnotationDecision {
  return rawDecideAnnotationSync(row, mode) as ZoteroAnnotationDecision;
}

/** The fields that differ between local and remote, in TS order (Rust `diff_annotation_fields`). */
export function diffAnnotationFields(row: ZoteroAnnotationSyncRow): ZoteroAnnotationFieldConflict[] {
  return rawDiffAnnotationFields(row) as ZoteroAnnotationFieldConflict[];
}

/**
 * Apply a conflict choice (Rust `resolve_annotation_conflict`). Any choice other
 * than `keep_local` or `accept_remote` merges.
 */
export function resolveAnnotationConflict(
  row: ZoteroAnnotationSyncRow,
  choice: "keep_local" | "accept_remote" | "merge",
): ZoteroAnnotationLocal | null {
  return rawResolveAnnotationConflict(row, choice) as ZoteroAnnotationLocal | null;
}

/** Zotero Web API payload for one annotation (Rust `to_zotero_write_payload`). */
export function toZoteroWritePayload(
  ann: ZoteroAnnotationLocal,
  parentItemKey: string,
): ZoteroAnnotationWritePayload {
  return rawToZoteroWritePayload(ann, parentItemKey) as ZoteroAnnotationWritePayload;
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
