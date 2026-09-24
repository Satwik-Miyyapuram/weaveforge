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
 *
 * `select` and `lasso` are two different jobs and were one tool until a loop
 * drawn round a paragraph selected the paragraph. `select` is the **reader's**:
 * it is the pointer a paper is read with — drag across text to highlight it,
 * fire a link, copy a sentence. `lasso` is the **writer's**: it picks ink up,
 * and with it armed the page's text is not a target at all, so a loop drawn over
 * a sentence takes the marks on it rather than the sentence. One tool cannot do
 * both, because a drag is a text selection *or* a loop and never both.
 */
export type ReaderCreateTool =
  | "select"
  | "lasso"
  | "ink"
  | "highlighter"
  | "erase"
  | "image"
  | "text";

const READER_INK_TOOLS = new Set<ReaderCreateTool>(["ink", "highlighter"]);

export function isInkTool(tool: ReaderCreateTool): boolean {
  return READER_INK_TOOLS.has(tool);
}

/**
 * Whether the tool takes the page's text away from the browser.
 *
 * The two region tools drag a box where the words would otherwise be selected,
 * the three ink tools draw on them, and the lasso loops round them — all five
 * mean "the page is the tool's surface, not the text's".
 */
export function toolOwnsThePage(tool: ReaderCreateTool): boolean {
  return tool !== "select";
}
