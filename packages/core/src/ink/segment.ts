/** Types for segment. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

