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

