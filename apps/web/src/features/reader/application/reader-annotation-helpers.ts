import { buildAnnotationSortIndex, type NewReaderAnnotation, type ReaderAnnotation } from "@weaveforge/core";

/** Pin / quotation-type key: Zotero key when present, else local id. */
export function annotationPinKey(ann: Pick<ReaderAnnotation, "id" | "zoteroKey">): string {
  return ann.zoteroKey?.trim() || ann.id;
}

/**
 * Apply an edit locally exactly as the repository will store it.
 *
 * The trimming and the blank-colour default mirror
 * `SupabaseReaderAnnotationRepository.update`. If they drifted apart the
 * optimistic value would visibly change when the persisted row arrived, which
 * looks like the edit was rejected and silently redone.
 */
export function applyAnnotationPatch(
  ann: ReaderAnnotation,
  patch: { comment?: string; tags?: string[]; color?: string },
): ReaderAnnotation {
  return {
    ...ann,
    ...(patch.color !== undefined ? { color: patch.color.trim() || "#ffd400" } : {}),
    ...(patch.comment !== undefined ? { comment: patch.comment.trim() } : {}),
    ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
  };
}

/** Marks an annotation that exists only on screen, awaiting its server row. */
export const PENDING_ANNOTATION_PREFIX = "pending:";

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

/**
 * What a pointer drag on the page does.
 *
 * `ink` and `highlighter` both produce Zotero ink annotations and differ only
 * in nib width — see `HIGHLIGHTER_MIN_WIDTH` in core for why the distinction is
 * carried by the width rather than by a field Zotero would drop.
 */
export type ReaderCreateTool = "select" | "ink" | "highlighter" | "erase" | "image" | "text";

const READER_INK_TOOLS = new Set<ReaderCreateTool>(["ink", "highlighter"]);

export function isInkTool(tool: ReaderCreateTool): boolean {
  return READER_INK_TOOLS.has(tool);
}
