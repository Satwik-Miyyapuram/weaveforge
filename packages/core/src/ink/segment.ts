/** Types for segment. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { InkLineRecord, InkStroke } from "./ink-note.js";
import type { InkLine } from "./recognise.js";

/** Idle gap after which a stroke starts a new line rather than joining one. */
export const INK_GROUP_WINDOW_MS = 2_000;

/**
 * How far a stroke's centre may sit from the line's, as a fraction of the
 * running median stroke height. 0.6 admits a descender and a capital without
 * letting the line below join in.
 */
export const INK_LINE_BAND_RATIO = 0.6;

export interface InkSegmentation {
  /** Lines in reading order, top to bottom. */
  lines: InkLine[];
  /** The line each **input** stroke went into, `-1` when it was not segmented. */
  lineOfStroke: number[];
}

/** What recognition produced for one line, if anything. */
export interface RecognisedLineText {
  text: string;
  confidence: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SegmentFns {
  /** A stroke's vertical extent, `[yMin, yMax]`, or `null` when it has no points. */
  inkStrokeBand(stroke: InkStroke): [number, number] | null;
  /**
 * Group a page's strokes into lines.
 *
 * The rule, from §5.4: walking the strokes in time order, a stroke joins the
 * current line when its y-centre is within {@link INK_LINE_BAND_RATIO} of the
 * running median stroke height around the line's y-band **and** it started
 * within {@link INK_GROUP_WINDOW_MS} of the line's last stroke. Otherwise it
 * starts a new line. Lines come back sorted top to bottom, which is the order
 * the text layer is written in.
 */
  segmentInkLines(strokes: readonly InkStroke[], options?: { windowMs?: number; bandRatio?: number }): InkSegmentation;
  /**
 * Reorder a page's strokes so each line's strokes are contiguous, and build the
 * line records the container stores.
 *
 * The container's line table names a line's strokes as `strokeStart` +
 * `strokeCount` — a contiguous range — while a line's strokes are only
 * contiguous in time order, and lines interleave the moment a margin note or a
 * correction is added. So the order the page is *stored* in is line order, and
 * the stroke's own `lineIndex` is what makes the association explicit either
 * way. Strokes that were never segmented keep their relative order at the end.
 */
  applyInkSegmentation(strokes: readonly InkStroke[], segmentation: InkSegmentation, recognised?: readonly (RecognisedLineText | undefined)[]): { strokes: InkStroke[]; lines: InkLineRecord[] };
  /** The strokes of one line, by the container's range, with a bounds check. */
  inkLineStrokes(strokes: readonly InkStroke[], line: InkLineRecord): InkStroke[];
}
