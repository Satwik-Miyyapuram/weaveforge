/** Types for ink-stroke. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { INK_PEN_WIDTHS } from "../ink/width.js";

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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface InkStrokeFns {
  /**
 * One ink nib, in the note's own unit (0.1 mm), as PDF points.
 *
 * The bar and the note share one nib set — `INK_PEN_WIDTHS`, in 0.1 mm — and
 * this is the only place the unit changes, so a 0.3 mm pen draws the same line
 * on a paper as on a sheet of ruled paper and the two sets cannot drift apart.
 */
  inkNoteWidthToPdfPoints(tenths: number): number;
  isHighlighterInk(width: number | undefined): boolean;
  clampInkWidth(width: number): number;
  /**
 * Stroke width for a pointer's reported pressure.
 *
 * A mouse reports `0.5` while a button is down (and `0` otherwise), so only a
 * real pen ever produces anything else — which is why a flat width made pen
 * input look identical to mouse input. Pressure is applied per *stroke*, not
 * per point: per-point widths would mean storing a third number alongside every
 * x,y, half again the size of every stroke, and Zotero has nowhere to put it.
 * One width per stroke costs nothing and still makes a light stroke thin and a
 * pressed one thick.
 */
  inkWidthForPressure(pressure: number | undefined, base?: number): number;
  /** Mean of the pressures seen during a stroke, ignoring non-reporting samples. */
  meanPressure(samples: readonly number[]): number | undefined;
  /**
 * Whether a captured point is far enough from the last one to be worth storing.
 * The first point of a stroke always is.
 */
  shouldAppendInkPoint(path: readonly number[], x: number, y: number, minDistance?: number): boolean;
  /**
 * The indices {@link simplifyInkPath} would keep, rather than the points.
 *
 * Ink notes need this and the reader does not: a note's stroke carries a
 * pressure per point, and a point that survives for its *shape* is not the same
 * set as a point that must survive for its *pressure* (§4.4 of the ink plan).
 * Recovering the indices by matching coordinates back afterwards would be
 * ambiguous the moment a stroke crosses itself, so the simplification returns
 * them directly and `simplifyInkPath` is the coordinate view of the same pass.
 */
  simplifyPathIndices(path: readonly number[], tolerance?: number): number[];
  /**
 * Ramer–Douglas–Peucker over a flat point list.
 *
 * Iterative rather than recursive: a 4,000-point stroke recursing per point can
 * exhaust the stack in a browser, and losing the whole annotation to a
 * RangeError is a far worse outcome than a slightly larger stroke.
 */
  simplifyInkPath(path: readonly number[], tolerance?: number): number[];
  /** Round coordinates to `decimals`, dropping the float noise a device emits. */
  quantizeInkPath(path: readonly number[], decimals?: number): number[];
  /**
 * Storage-ready form of a captured stroke: simplified, rounded, and guaranteed
 * to be under {@link INK_MAX_POINTS} points. Returns `[]` for anything that is
 * not a drawable stroke, which callers treat as "nothing to save".
 */
  compactInkPath(path: readonly number[], options?: { tolerance?: number; maxPoints?: number; decimals?: number }): number[];
  /** Estimated stored size of a path, in JSON characters. Used by tests/budgets. */
  inkPathJsonSize(path: readonly number[]): number;
  /**
 * Whether a new stroke belongs to the annotation a group is building.
 *
 * Grouping is not cosmetic: one row per stroke meant a written sentence was
 * twenty rows to store, twenty entries in the sidebar, and twenty deletes to
 * undo it. Strokes drawn in the same breath, in the same colour and nib, on the
 * same page, are one mark.
 */
  canJoinInkGroup(group: InkGroupCandidate | null, next: { pageIndex: number; color: string; width: number; at: number }, windowMs?: number): boolean;
  /**
 * True when `(x, y)` lies within `radius` of any segment of any path. Used by
 * the eraser and by move-drag hit detection, both of which must match what the
 * user sees rather than a bounding box.
 */
  inkPathsHitTest(paths: readonly (readonly number[])[], x: number, y: number, radius: number): boolean;
  /** Translate every path by `(dx, dy)`, keeping stored precision. */
  translateInkPaths(paths: readonly (readonly number[])[], dx: number, dy: number, decimals?: number): number[][];
  /** Bounding box `[x1, y1, x2, y2]` of a set of paths, or null when empty. */
  inkPathsBounds(paths: readonly (readonly number[])[]): [number, number, number, number] | null;
}
