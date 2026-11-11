import type { InkLine } from "./recognise.js";

// --- decode ---
/** Types for decode. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** One word as the engine read it: readings best-first, and the dictionary's verdict on each. */
export interface InkWordReadings {
  candidates: readonly string[];
  /** Parallel to `candidates`; absent or null when the machine had no dictionary for the language. */
  known?: readonly boolean[] | null;
  /** This word and the next read as one, when the dictionary knows the joined reading. */
  join?: string | null;
}

/**
 * The most an engine's line may score. `1` is reserved: it marks a line a
 * person corrected, which `recognisePage` keeps through the next run rather
 * than recognising again, so an engine that reported `1` would freeze its own
 * guesses.
 */
export const INK_ENGINE_MAX_CONFIDENCE = 0.95;

/** How much each unsure word costs a line, as a share of its words. */
const UNSURE_PENALTY = 0.5;

/** Line alternatives offered for correction. */
const MAX_LINE_ALTERNATIVES = 4;

interface Chosen {
  text: string;
  sure: boolean;
  /** The engine's own pick was a non-word, even if another reading was kept. */
  doubted?: boolean;
  /** The other readings worth offering, best first. */
  others: string[];
}

// --- figure ---
/**
 * Figures: images placed on a page, in the text that already carries the page.
 *
 * A page of an ink note is markdown whose body is the recognised text layer;
 * a figure is one more image ref in that body — `![figure x=… y=… w=… h=…](vault:…)`
 * — so it lives where the note's own image bookkeeping already looks, moves
 * with the page under the CRDT, and survives as text in git. The same tokens
 * after an image's own alt text (`![photo right c=0,0,10,10|60%]`) place a
 * markdown note's image, because the two should not grow two syntaxes.
 *
 * The tokens are page units — tenths of a millimetre, the units every other
 * ink coordinate is in — except `c`, which is crop insets as percentages of
 * the image's own box (left, top, right, bottom) the way every crop tool
 * numbers them. A crop is geometry, not destruction: the bytes are untouched
 * and the crop is undone by clearing the token.
 *
 * The parsing and box maths live in the Rust core (`ink::figure`); this file
 * keeps the types and the signatures callers reach through `typedCore()`.
 */
/** The alt text that marks an image ref as a placed figure rather than prose. */
export const FIGURE_ALT = "figure";

/** An image placement: where on the page, how big, and how much of it shows. */
export interface FigureGeometry {
  /** The attachment this figure shows, without the `vault:` scheme. */
  path: string;
  /** The box's top-left corner from the page's top-left, in page units. */
  x: number;
  y: number;
  /** The box's size, in page units. */
  w: number;
  h: number;
  /**
   * How much of the image is cropped off, as percentages of its own box:
   * `[left, top, right, bottom]`, each 0–99. Absent or null means the whole image.
   */
  crop?: [number, number, number, number];
}

/** A box in page units. */
type Box = { x: number; y: number; w: number; h: number };

/** Where a figure moves in the page's stacking order. */
export type FigureOrderStep = "front" | "forward" | "backward" | "back";

/** A handle on a figure's box: a corner or an edge. */
export type FigureHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The handles a box shows, in reading order. */
export const FIGURE_HANDLES: readonly FigureHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// --- segment ---
/** Types for segment. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

// --- smooth ---
/** Types for smooth. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * Stroke smoothing at commit: the pass that makes a stroke look drawn.
 *
 * The live filter (1-Euro) is causal, so it can only trade lag for smoothness
 * and leaves what a digitiser adds at 120 Hz: a sample every 0.3–1 mm whose
 * spacing and lateral position both jitter by a fraction of a unit. A curve
 * through those samples wobbles at the sample rate, which is the "not smooth"
 * a reader sees next to OneNote's ink, and it is not lag OneNote is spending to
 * avoid it — its stroke is *refitted* once the pen lifts.
 *
 * This is that refit, done the cheap way: the stroke is resampled to an even
 * spacing along its length, and the resampled points are run through a
 * binomial kernel with the ends pinned. The kernel is non-causal, so there is
 * no lag to pay, and at the spacing used it moves a point by less than the
 * width of the nib while removing the sample-rate wobble entirely. Corners
 * survive because the kernel is only two samples wide: a sharp turn rounds by
 * under half a millimetre, which is what a real pen does.
 */

/** Spacing the stroke is resampled to before smoothing, in 0.1 mm. */
export const INK_SMOOTH_SPACING = 3;

/** Smoothing passes of the five-tap binomial kernel. */
export const INK_SMOOTH_PASSES = 2;

export interface SmoothedInkStroke {
  points: number[];
  pressures: number[];
}

// --- stroke-packer ---
/**
 * Packing a stroke for storage while it is written: points are only appended,
 * so the stroke committed on lift is the last one drawn. The packer lives in
 * the Rust core (wf-core `ink::stroke_packer`); these are its shapes.
 */
export interface InkStrokePackerOptions {
  tolerance?: number;
  maxPoints?: number;
  pressureTolerance?: number;
}

/** A live packer for one stroke, as the Rust core builds it. */
export interface LiveInkStrokePacker {
  /** Add the pen's next sample, in 0.1 mm, with its 0–255 pressure if it has one. A non-finite one is skipped. */
  push(x: number, y: number, pressure?: number | null): void;
  /** The stroke so far, as flat x,y pairs: every kept point, then the pen's latest sample. */
  points(): Float64Array;
  /** One pressure byte per point of `points()`. */
  pressures(): Float64Array;
}

// --- width ---
/** Types for width. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * Ink nib widths, in **tenths of a millimetre**, for ink *notes*.
 *
 * This module exists because the reader's width helpers are in PDF units and
 * cannot be reused for the sidecar. `clampInkWidth` (`reader/ink-stroke.ts`)
 * clamps to `[0.75, 24]`, which read as 0.1 mm is `[0.075 mm, 2.4 mm]` — a 6 mm
 * highlighter would clamp to less than the pen's own maximum, and
 * `HIGHLIGHTER_MIN_WIDTH = 8` would classify a 0.9 mm pen as a highlighter while
 * missing a 0.6 mm one. Ink notes store one integer width per stroke and one
 * pressure per point, so the units, the thresholds and the taper all live here
 * and `reader/ink-stroke.ts` is left alone.
 *
 * A page is A4 at 2100 × 2970 units (210 × 297 mm), which is what makes the
 * `Int16` coordinate range in the chunk format comfortable: ±32767 units is
 * ±3.2 m, and a single page never approaches it.
 */

/** Units per millimetre. Every width and coordinate in ink notes is in these. */
export const INK_WIDTH_UNITS_PER_MM = 10;

/**
 * The pen widths the ink bar offers, in 0.1 mm: 0.1, 0.3, 0.5 and 0.7 mm —
 * the nib sizes a stationery catalogue prints, so a person who writes with a
 * 0.3 gets the line they know. They are the rendered width at rest pressure;
 * pressure and speed move it either way from there (below).
 */
export const INK_PEN_WIDTHS = [1, 3, 5, 7] as const;

/**
 * The default pen, 0.3 mm — the fine-liner most handwriting is done with —
 * and the width a stroke with no usable one falls back to. The sheet's text
 * is sized to match it: 4.8 mm type on a 7.2 mm pitch is what a 0.3 mm pen
 * writes on college-ruled paper (`INK_UNDERLAY`).
 */
export const INK_PEN_WIDTH = 3;

/** Highlighter nib: 6 mm, the width the plan and the prototype both name. */
export const INK_HIGHLIGHTER_WIDTH = 60;

/**
 * The highlighter widths the ink bar offers, in 0.1 mm: 3, 4.5, 6 and 9 mm —
 * a single text line, a line and a half, the default, and two lines. Each
 * stays at or above `INK_HIGHLIGHTER_MIN_WIDTH`, so a stored stroke without a
 * tool still reads back as a highlighter.
 */
export const INK_HIGHLIGHTER_WIDTHS = [30, 45, 60, 90] as const;

/**
 * At or above this width a stroke is painted as a highlighter.
 *
 * The stored `tool` field is authoritative and this is the fallback for a
 * stroke that has none — a chunk written by an older version, or a reader-ink
 * stroke imported into a page. 2.5 mm sits well clear of the 1.0 mm pen and
 * well under the 6 mm highlighter.
 */
export const INK_HIGHLIGHTER_MIN_WIDTH = 25;

/** Tightest and widest a nib may be: 0.1 mm to 20 mm. */
export const INK_MIN_WIDTH = 1;

export const INK_MAX_WIDTH = 200;

/** Speed at which the velocity taper reaches its floor, in 0.1 mm per ms. */
export const INK_VELOCITY_FULL_TAPER = 4;

/** How much thinner a stroke gets at full speed: 20 % off the base width. */
export const INK_VELOCITY_TAPER = 0.2;

/** Lightest and heaviest a pressure of 0 and 1 scale the base width by. */
export const INK_PRESSURE_MIN_FACTOR = 0.7;

export const INK_PRESSURE_MAX_FACTOR = 1.3;

// --- zoom ---
/** Types for zoom. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * The one zoom table for ink: the note canvas and the ink reader, through
 * every input (bar buttons, presets, keys, wheel and pinch).
 */

/** Smallest ink zoom: half size. */
export const INK_ZOOM_MIN = 0.5;

/** Largest ink zoom: four times. */
export const INK_ZOOM_MAX = 4;

/** One zoom-in or zoom-out step, as a factor. */
export const INK_ZOOM_STEP = 1.25;
