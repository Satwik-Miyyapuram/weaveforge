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

/**
 * A stroke width clamped to what a nib can be.
 *
 * The fallback is the default pen rather than the minimum: a width that arrived
 * as `NaN` or as a string's worth of nonsense is a missing width, not a request
 * for a hairline.
 */
export function clampInkNoteWidth(width: number, fallback = INK_PEN_WIDTH): number {
  if (!Number.isFinite(width)) return fallback;
  return Math.min(INK_MAX_WIDTH, Math.max(INK_MIN_WIDTH, Math.round(width)));
}

/** Whether a width alone marks a stroke as a highlighter. */
export function isHighlighterWidth(width: number): boolean {
  return Number.isFinite(width) && width >= INK_HIGHLIGHTER_MIN_WIDTH;
}

/**
 * How pressure scales the base width, as a multiplier.
 *
 * A device that does not report pressure reports `0`, and a mouse reports `0.5`
 * while its button is down; both mean "no information" and both leave the width
 * alone. That is the same rule the reader learned, and it is why a pen on a
 * tablet that reports pressure looks different from a mouse without one.
 */
export function inkPressureFactor(pressure: number | undefined): number {
  if (typeof pressure !== "number" || !Number.isFinite(pressure)) return 1;
  if (pressure <= 0 || pressure === 0.5) return 1;
  const clamped = Math.min(1, pressure);
  return (
    INK_PRESSURE_MIN_FACTOR + clamped * (INK_PRESSURE_MAX_FACTOR - INK_PRESSURE_MIN_FACTOR)
  );
}

/**
 * How speed scales the base width, as a multiplier.
 *
 * The natural thinning on a fast stroke is most of what makes handwriting look
 * written rather than drawn, and the sample stream already carries it: velocity
 * is derived from position and time, so it costs no storage at all. The taper is
 * linear to {@link INK_VELOCITY_FULL_TAPER} and flat above it, so a stroke has a
 * floor rather than vanishing.
 */
export function inkVelocityFactor(
  velocity: number,
  fullTaper = INK_VELOCITY_FULL_TAPER,
): number {
  if (!Number.isFinite(velocity) || velocity <= 0) return 1;
  const fraction = Math.min(1, velocity / fullTaper);
  return 1 - fraction * INK_VELOCITY_TAPER;
}

/**
 * The rendered width at one point: base nib, pressure and speed together.
 *
 * This is `f(width, pressure, velocity)` from the plan, and it is the single
 * definition both the worker's geometry and the delegated trail call — the plan
 * is explicit that two filters, or a width computed two ways, reintroduce the
 * seam at pen-up. The result is clamped but deliberately **not** rounded: the
 * GPU expands the strip at a fractional width, and rounding here would quantise
 * the taper the format was changed to keep.
 */
export function nibWidth(
  base: number,
  pressure?: number,
  velocity = 0,
  options: { fullTaper?: number } = {},
): number {
  const clampedBase = clampInkNoteWidth(base);
  const width =
    clampedBase * inkPressureFactor(pressure) * inkVelocityFactor(velocity, options.fullTaper);
  return Math.min(INK_MAX_WIDTH, Math.max(INK_MIN_WIDTH, width));
}

/**
 * Velocity in 0.1 mm per ms from two samples.
 *
 * Time is in milliseconds and the coordinates are 0.1 mm, so the division needs
 * no unit change; a zero gap is treated as infinitely fast, which is what a
 * duplicated timestamp means.
 */
export function inkVelocityBetween(
  x0: number,
  y0: number,
  t0: number,
  x1: number,
  y1: number,
  t1: number,
): number {
  const dt = t1 - t0;
  if (!Number.isFinite(dt) || dt <= 0) return dt === 0 ? Number.POSITIVE_INFINITY : 0;
  return Math.hypot(x1 - x0, y1 - y0) / dt;
}

/**
 * Mean nib width for a whole stroke from its samples.
 *
 * The reader derives one width per stroke from a mean pressure, and the note
 * format still stores one base width per stroke even though the *rendered* width
 * varies per point. Keeping the base honest means a stroke re-rendered from
 * geometry alone — an export, a thumbnail, the Canvas 2D fallback — still has
 * the width the user drew with.
 */
export function strokeBaseWidth(
  samples: readonly number[],
  base: number,
): number {
  const usable = samples.filter((pressure) => Number.isFinite(pressure) && pressure > 0);
  if (usable.length === 0) return clampInkNoteWidth(base);
  const mean = usable.reduce((sum, pressure) => sum + pressure, 0) / usable.length;
  return clampInkNoteWidth(base * inkPressureFactor(mean));
}
