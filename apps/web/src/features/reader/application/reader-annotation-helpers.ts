/** Marks an annotation that exists only on screen, awaiting its server row. */
export const PENDING_ANNOTATION_PREFIX = "pending:";

/** Zotero's yellow: the colour a mark gets when none is given. */
export const DEFAULT_ANNOTATION_COLOR = "#ffd400";

export const READER_ANNOTATION_COLORS = [
  DEFAULT_ANNOTATION_COLOR,
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
] as const;

export interface PagePress {
  x: number;
  y: number;
  time: number;
}

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

