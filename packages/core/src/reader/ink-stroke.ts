/** Types for ink-stroke. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/**
 * Hardest cap on one stroke. Reached only by a stroke that is genuinely long
 * and wiggly; the tolerance is raised until the stroke fits rather than the
 * tail being cut, so the shape degrades gracefully instead of losing its end.
 */
export const INK_MAX_POINTS = 400;

/**
 * How many strokes one annotation row may hold before the next stroke starts a
 * new row. Grouping is what stops a written sentence becoming twenty rows and
 * twenty sidebar entries; this bound stops it becoming one unbounded row.
 */
export const INK_MAX_PATHS_PER_ANNOTATION = 64;

export const INK_DEFAULT_WIDTH = 2;

/**
 * The rail's four nibs, in PDF points, derived from the ink note's set:
 * 0.28 / 0.85 / 1.42 / 1.98 pt.
 */
export const INK_NIB_WIDTHS_PT: readonly number[] = [0.28, 0.85, 1.42, 1.98];

/**
 * The rail's default nib, 0.5 mm. One step up from the ink note's 0.3 mm
 * (`INK_PEN_WIDTH`): a page of 10 pt type is read at a smaller scale than a
 * sheet of ruled paper, and 0.3 mm on it reads as a hairline.
 */
export const INK_NIB_DEFAULT_PT: number = 1.42;

/** Nib width of the highlighter tool, in PDF units. */
export const HIGHLIGHTER_WIDTH = 14;

/**
 * At or above this width an ink stroke is painted as a highlighter: translucent
 * and multiplied over the page rather than drawn on top of it.
 *
 * Zotero's ink annotation carries a `width` and nothing else — there is no
 * "tool" field to write back, and inventing one would either be dropped on sync
 * or corrupt the item for Zotero's own reader. Deriving the look from the width
 * keeps a highlighter a plain Zotero ink annotation that happens to be thick.
 */
export const HIGHLIGHTER_MIN_WIDTH = 8;

export interface InkGroupCandidate {
  pageIndex: number;
  color: string;
  width: number;
  /** Strokes the target annotation already holds. */
  pathCount: number;
  /** When the group last took a stroke. */
  lastAt: number;
}

