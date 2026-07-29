import { buildAnnotationSortIndex, type NewReaderAnnotation, type ReaderAnnotation } from "@thesis/core";

/** Pin / quotation-type key: Zotero key when present, else local id. */
export function annotationPinKey(ann: Pick<ReaderAnnotation, "id" | "zoteroKey">): string {
  return ann.zoteroKey?.trim() || ann.id;
}

/** Marks an annotation that exists only on screen, awaiting its server row. */
export const PENDING_ANNOTATION_PREFIX = "pending:";

export function isPendingAnnotationId(id: string): boolean {
  return id.startsWith(PENDING_ANNOTATION_PREFIX);
}

/**
 * Build the annotation to paint immediately, before the write returns.
 *
 * Waiting for the round-trip meant a highlight appeared only after the server
 * answered — hundreds of milliseconds of nothing happening after the user
 * clicked, which reads as a broken control rather than a slow one. The caller
 * swaps this for the persisted row on success and removes it on failure.
 */
export function optimisticAnnotationFromDraft(
  draft: NewReaderAnnotation,
  id: string,
  now = new Date().toISOString(),
): ReaderAnnotation {
  return {
    id,
    origin: "local",
    zoteroKey: null,
    type: draft.type,
    color: draft.color.trim() || "#ffd400",
    text: draft.text?.trim() ?? "",
    comment: draft.comment?.trim() ?? "",
    tags: draft.tags ? [...draft.tags] : [],
    anchor: draft.anchor,
    sortIndex: draft.sortIndex?.trim() || buildAnnotationSortIndex(draft.pageIndex, 0, 0),
    createdAt: now,
    updatedAt: now,
    syncState: "local",
    zoteroVersion: null,
  };
}

export const READER_ANNOTATION_COLORS = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
] as const;

export type ReaderCreateTool = "select" | "ink" | "image" | "text";
