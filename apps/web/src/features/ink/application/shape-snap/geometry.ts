/**
 * Shape snap: the freehand mark that becomes the figure the user meant to draw.
 *
 * §6.3 gives the Shape tool one job — "rough line / rect / ellipse / arrow, hold
 * 400 ms → snapped; `shape` field" — and this module is the *pure geometry* half
 * of it. It answers exactly one question: given the samples the pen produced,
 * which of the four primitives was that, and what are its parameters? The hold
 * timer, the gesture arbitration, the preview and the mutation of the stroke are
 * the host's business; nothing here reads a clock, a pointer event or React.
 *
 * **Six judgements in one place, and a confidence that says how close the call
 * was.** §7 step 8 asks for figures "drawn, tidied and exported", so a wrong snap
 * is worse than no snap: the user then has to undo a correction they did not ask
 * for. This module therefore fits *all four* primitives and returns the best one
 * only when it is both inside the acceptance band and ahead of its closest rival
 * by {@link SHAPE_ACCEPT_MARGIN}. An ambiguous mark — and a rough square is
 * ambiguous, because it is also a terrible circle — is left alone. `"none"` is a
 * first-class result, not a failure.
 *
 * **Closed-form only, because this runs on the pen path.** No dependency, no
 * iteration to a tolerance, no training data: the line is a least-squares fit,
 * the axis-aligned rectangle is a band test in the page frame, the ellipse is a
 * moment (principal-axis) fit scored by radial residual, and the arrow is a
 * corner test on the widest pair of segments. Each takes one pass over the
 * samples, so a snap can run inside the 400 ms hold without a frame budget of
 * its own.
 *
 * **The four gates are pre-filters, and they are deliberately strict.** A line
 * whose samples double back on themselves is an arrow or a letter, never a line;
 * a closed shape that never closes cannot be a rect or an ellipse; an ellipse
 * needs a point cloud with two spread axes before "eccentricity" means anything.
 * Gating first is what keeps the ellipse fit from snapping a scribble, which has
 * a perfectly serviceable principal axis and a residual that says so.
 *
 * **Every path here keeps the user's first and last samples as its endpoints.**
 * A snap clarifies the middle of a mark; it does not move where the pen went
 * down or came up. For a line the endpoints are kept and the interior is
 * projected onto the fit, so a hand-drawn line becomes straight without getting
 * shorter by the length of the wobble. For a closed shape the path *is* closed,
 * so the first sample is the seam and the last one lands back on it.
 *
 * Coordinates are absolute integers in 0.1 mm, the same unit as
 * `core/ink/ink-note.ts` and `application/one-euro-filter.ts`: a point is a pair
 * of numbers, so a path is a flat `[x0, y0, x1, y1, …]` array and never an array
 * of objects. The unit is load-bearing for the thresholds below — 10 units is a
 * millimetre, and 1 unit is a tenth of one, which is below what the eye resolves
 * at 100 % zoom on the target hardware (§4.4), so an error expressed as a
 * fraction of the mark's own span is scale-free and needs no calibration.
 */

/* -------------------------------------------------------------------------
 * Vocabulary
 * ---------------------------------------------------------------------- */

/**
 * The four primitives §6.3 names, plus the abstention.
 *
 * The names are `InkShape`'s (`core/ink/ink-note.ts`), and the order is that
 * vocabulary's order, so the index the sidecar stores and the name the UI shows
 * cannot drift apart.
 */
export type SnapShape = "none" | "line" | "rect" | "ellipse" | "arrow";

/** A point in 0.1 mm, as `[x, y]`. */
export type SnapPoint = readonly [number, number];

/**
 * A freehand path: absolute integer coordinates in 0.1 mm, `[x0, y0, x1, y1, …]`.
 *
 * The same shape `InkStroke.points` has, so passing a stroke's geometry in is
 * one property read and no mapping allocation on the pen path.
 */
export type SnapPath = readonly number[];

/**
 * An axis-aligned box in 0.1 mm, extremes inclusive.
 *
 * An object rather than the reader's `[x1, y1, x2, y2]` tuple: a named field
 * cannot be reordered by accident, and the one call site that has a tuple
 * (`inkPathsBounds`) is a two-line adapter rather than a source of confusion.
 */
export interface SnapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/* -------------------------------------------------------------------------
 * Acceptance thresholds
 *
 * The numbers below are fractions of a mark's own extent, so they mean the same
 * thing for a 5 mm tick and a 200 mm figure. `SHAPE_MIN_SPAN` is the one
 * absolute figure, because "too small to be a deliberate shape" is a fact about
 * the hand and the page, not about the mark's proportions.
 * ---------------------------------------------------------------------- */

/**
 * The smallest mark worth recognising: 5 mm across, in 0.1 mm.
 *
 * Below this a mark is a tick, a dot, an i-dot or a comma, and all four
 * primitives can be fitted to it with a plausible residual — a 1 mm tick is a
 * 0.4-unit-wide "rectangle" with four corners. The pen's own narrowest nib is
 * 0.3 mm (§6.3) and the smallest pen width the bar offers is 0.3 mm, so 5 mm is
 * an order of magnitude clear of anything a deliberate figure would be, and
 * still short enough to catch a tiny box drawn beside a paragraph.
 */
export const SHAPE_MIN_SPAN = 50;

/** Two distinct samples are the minimum that can carry a direction at all. */
export const SHAPE_MIN_POINTS = 2;

/**
 * A line may not wander more than this fraction of its span, on average.
 *
 * §4.4 calls a PDF point ~0.35 mm and 0.1 mm "well below what the eye resolves
 * at 100 % zoom", so 4 % of a mark's span is visibly off the ruled line and
 * anything under it reads as straight. A deliberate hand-drawn line measured on
 * a tablet wobbles by 1–2 % of its length; a 4 % band therefore accepts the hand
 * and rejects a curve, and 2× the smallest drawn line (10 mm) is 1 mm of
 * allowed wander, which is about a nib's width at the fattest pen setting.
 */
export const LINE_ERROR_LIMIT = 0.04;

/**
 * A line may not double back on itself by more than this fraction of its span.
 *
 * This is the rule that separates a line from an arrow, and it is the *only*
 * one that does — the arrow's head sits close enough to the shaft that a
 * least-squares residual prefers the line. A retrace is unambiguous: the pen
 * covered the same ground twice, and `2` in the shape vocabulary means a figure,
 * not a stroke the user redrew. 3.5 % of the span is roughly one nib-width of
 * backtracking on a 6 mm nib, so a tremor is free and a head is not.
 */
export const LINE_BACKTRACK_LIMIT = 0.035;

/**
 * A line's successive segments must not turn more than about 105° between them.
 *
 * The back-tracking rule catches an arrow's shaft-to-head fold; this catches the
 * one backtracking misses — a stroke that folds back at a distance, where the
 * projection along the fit barely moves but the pen clearly reversed. `-0.25`
 * rather than `0` so a sample-level wobble at a genuine corner of a straight
 * line is not mistaken for a turn.
 */
export const LINE_MIN_SEGMENT_COS = -0.25;

/**
 * A rectangle must be closed to within this fraction of its span.
 *
 * §6.4's own words for a closed shape are "overlaps"; a hand-drawn square leaves
 * a gap of a millimetre or two, which at 10 mm and up is under 20 %. 25 % is the
 * generous end of that: an open "C" that happens to have four sides is still
 * refused, because its gap is a side's length, not a corner's.
 */
export const CLOSED_GAP_LIMIT = 0.25;

/**
 * A rectangle must be walked at least this far around its own box diagonal.
 *
 * A rough square's path is at least 2× its diagonal (four sides against one
 * diagonal); an arrow is 1.13×. `1.9` therefore refuses the arrow long before
 * any residual is computed, and still admits a square drawn in one quick loop
 * whose corners are rounded off.
 */
export const RECT_MIN_PERIMETER_RATIO = 1.9;

/**
 * A rectangle's second principal spread, as a fraction of its first.
 *
 * A line is the degenerate rectangle: its minor spread is the pen's own width,
 * so the "box" the fit would return has four corners stacked on one line and its
 * outline passes through every sample — a perfect fit of a shape nobody drew. A
 * square sits at 1.0 and the flattest thing worth calling a box is about 1:4, so
 * 0.25 separates them with room on both sides.
 */
export const RECT_MIN_MINOR_RATIO = 0.25;

/**
 * A rectangle's samples must average within this fraction of the box outline.
 *
 * The outline is the fitted box, not the drawn one, so a corner overshoot is
 * charged at its real distance. 6 % of the span is half again the line's 4 %,
 * because a rectangle has four corners and every one of them is a place the hand
 * rounds off; a rough circle's samples sit 11 % off its box outline on average,
 * which is why the circle does not come through here.
 */
export const RECT_BAND_LIMIT = 0.06;

/**
 * Fraction of a rectangle's samples that must lie near one of the four corners.
 *
 * A path that traces a circle passes within the box's band but never dwells
 * near a corner, and a path with only two corners is a bracket rather than a
 * box. A quarter of the samples within {@link RECT_CORNER_BAND} of some corner
 * is what a square with rounded corners produces; a circle produces none.
 */
export const RECT_CORNER_SUPPORT = 0.25;

/** How near a corner a sample must be to count as supporting it, as a span fraction. */
export const RECT_CORNER_BAND = 0.12;

/**
 * How far a rectangle may lean before the tool refuses to straighten it, in degrees.
 *
 * §6.3's Shape tool snaps a *rough* rectangle to an axis-aligned one; a box the
 * user deliberately rotated is a figure, and silently axis-aligning it would
 * destroy the drawing. A 5° lean on a 60 mm box drops the far corner by 5 mm —
 * half a line of ruled paper, plainly visible — so 7° is the largest lean that
 * still reads as "I meant to draw this straight", and it is measured modulo 90°
 * so the choice of long side does not matter.
 */
export const RECT_TILT_LIMIT_DEGREES = 7;

/**
 * The narrowest second axis a point cloud may have and still be an ellipse.
 *
 * A circle is an ellipse — the plan's `"ellipse"` verdict is what both get, and
 * {@link CIRCLE_MODULATION} is the separate question of whether to offer one
 * radius or two — so this cannot be an eccentricity floor. What it has to keep
 * out is the *degenerate* fit: a straight line's minor spread is the pen's own
 * width, and an ellipse fitted to one passes through every sample with a
 * residual of zero, which would make every line an ellipse. `0.2` is a 5:1
 * shape, comfortably beyond the flattest ellipse anyone draws on a page and far
 * beyond the 1:40 of a line.
 */
export const ELLIPSE_MIN_AXIS_RATIO = 0.2;

/**
 * An ellipse's samples must average within this fraction of the fitted curve.
 *
 * The residual is the radial distance from the fitted centre, measured along
 * each sample's own ray, divided by the semi-major axis. A hand-drawn circle
 * lands at 2–4 %; a rough square at 15–25 %, because its corners are half again
 * as far out as its edge midpoints. `0.08` is the midpoint of that gap.
 */
export const ELLIPSE_ERROR_LIMIT = 0.08;

/**
 * A closed mark must be closed before it can be an ellipse, as a span fraction.
 *
 * The same rule as {@link CLOSED_GAP_LIMIT} and the same number: an arc is a
 * curve, not a loop, and a gesture that stops two-thirds of the way round has
 * told the user's hand's story, not the tool's.
 */
export const ELLIPSE_GAP_LIMIT = 0.25;

/**
 * Below this radial modulation an ellipse *is* a circle, as a span fraction.
 *
 * The distinction is not a different fit — a circle is an ellipse with equal
 * axes — but a different affordance: the UI can offer to resize a circle by one
 * radius. 0.1 is a 10 % difference between the axes, which is one drag of the
 * pen's own accuracy and under what the eye calls "not round".
 */
export const CIRCLE_MODULATION = 0.1;

/**
 * An arrow's head must be at least this fraction of the mark, measured by reach.
 *
 * A line with a flick at the end should stay a line, and a mark whose "head" is
 * 1 % of its length has no head. 5 % of the span is 5 mm on a 100 mm arrow,
 * which is the shortest barbs a reader parses as a direction.
 */
export const ARROW_MIN_HEAD_REACH = 0.05;

/** A shaft plus a head: the pen must cover this much more than the span it crosses. */
export const ARROW_MIN_PATH_RATIO = 1.12;

/** The head may not be more than this fraction of the mark — beyond it, the tail is the head. */
export const ARROW_MAX_HEAD_RATIO = 0.5;

/** An arrow's barbs must open by at least this much, in degrees, or they are the shaft. */
export const ARROW_MIN_OPENING_DEGREES = 15;

/**
 * An arrow's barbs may not open past this, in degrees, or they are a T-bone.
 *
 * A real arrow head opens 30–60°; a right angle is already a crossbar. 150°
 * leaves room for a hand that draws barbs wide and short.
 */
export const ARROW_MAX_OPENING_DEGREES = 150;

/**
 * A shaft's samples must average within this fraction of the fitted line.
 *
 * An arrow's shaft is drawn faster and less carefully than a line the user
 * wants straight — it is scaffolding for the head — so the band is looser than
 * {@link LINE_ERROR_LIMIT}, and it is what stops a bent polyline from claiming
 * to be an arrow.
 */
export const ARROW_SHAFT_ERROR_LIMIT = 0.06;

/**
 * How much better the winner must be than its closest rival.
 *
 * A rough square is roughly a circle and roughly a rectangle; fitting both and
 * comparing residuals is the only way to tell, and one of them wins by a nose
 * whenever the drawing is genuinely ambiguous. Requiring the winner's residual
 * to be at least this much smaller than the runner-up's — as a fraction of the
 * winner's own residual — means "a nose" is not enough. It is the abstention
 * rule, and §6.3's promise that the tool tidies a figure depends on it.
 */
export const SHAPE_ACCEPT_MARGIN = 0.15;

/**
 * The weakest fit that may be applied, as a residual fraction of the shape's size.
 *
 * The pre-filters already refuse a scribble; this is the last backstop for a
 * candidate that cleared its gate barely. Below it the snap is a guess, and a
 * guess the user has to undo is worse than a stroke they draw again.
 */
export const SHAPE_MIN_CONFIDENCE = 0.25;

/* -------------------------------------------------------------------------
 * Fitted geometry — what the renderer draws
 * ---------------------------------------------------------------------- */

/** A straight mark from `start` to `end`, the user's own first and last samples. */
export interface LineGeometry {
  kind: "line";
  start: SnapPoint;
  end: SnapPoint;
  /** Length in 0.1 mm, carried rather than recomputed by every consumer. */
  length: number;
}

/**
 * A quadrilateral, in draw order, with the seam the pen used.
 *
 * `corners` are the four fitted vertices and `closed` is `true`: the renderer
 * closes the loop back to `corners[0]`. `corners[0]` is the one nearest the
 * user's first sample and the rest follow the direction the pen travelled, so
 * the snapped path grows from where the mark began — the *appearance* of the
 * snap is that the user's own rectangle got straight, not that a new one
 * appeared somewhere on the page.
 */
export interface RectGeometry {
  kind: "rect";
  corners: readonly SnapPoint[];
  closed: true;
  /** The rotation the fit found, in degrees, before any axis-alignment. */
  rotationDegrees: number;
}

/**
 * A centre-form ellipse: the fit a renderer draws, and the shape a UI resizes.
 *
 * Centre and semi-axes rather than two foci, because a diagonal ellipse's axes
 * are what an SVG `ellipse` takes and what a drag handle acts on. `circle` is
 * the affordance flag from {@link CIRCLE_MODULATION}, not a different fit.
 */
export interface EllipseGeometry {
  kind: "ellipse";
  centre: SnapPoint;
  radiusX: number;
  radiusY: number;
  /** Major-axis rotation, in degrees, in page space. */
  rotationDegrees: number;
  circle: boolean;
}

/**
 * A long shaft with a short head: the widest pair of segments, plus the tips.
 *
 * The path a renderer draws is `shaftPath` — a continuous polyline from the
 * start, through the shaft, out to the tip. The barbs are `head`, drawn from
 * `tip` to each of the two vertices, closed back to `tip` so the head is one
 * stroke with its own pen-up and pen-down at the same place. Keeping them
 * separate is the fix for the retrace: drawing the whole thing as one path would
 * paint the last stretch of shaft twice and leave the visible bead the stencil
 * rule exists to avoid (§6.2.3).
 */
export interface ArrowGeometry {
  kind: "arrow";
  start: SnapPoint;
  tip: SnapPoint;
  /** The two barb vertices, in the order the pen met them, `[left, right]`. */
  head: readonly [SnapPoint, SnapPoint];
  /** The centreline stroke: the shaft, ending at the tip. */
  shaftPath: readonly SnapPoint[];
  /** The head as its own path: `tip → head[0] → tip → head[1]`. */
  headPath: readonly SnapPoint[];
}

/** Any fitted primitive, discriminated by `kind`. */
export type SnapGeometry =
  LineGeometry | RectGeometry | EllipseGeometry | ArrowGeometry;

/**
 * One fitted candidate: what it is, how well it fits, and how sure that makes us.
 *
 * `error` is comparable *between* candidates — every fit reports the mean
 * distance between the samples and its own curve, divided by its own size — which
 * is what lets one ranking rule choose between a rectangle and an ellipse. It is
 * not comparable across gestures, and it is not a probability. `confidence`
 * folds the error and the acceptance margin into `[0, 1]` so the UI has one
 * number for a badge, and is `0` for a fit that would be refused.
 */
export interface ShapeFit<G extends SnapGeometry = SnapGeometry> {
  shape: Exclude<SnapShape, "none">;
  error: number;
  confidence: number;
  geometry: G;
}

/** Every primitive's fit, computed together so the choice between them is explicit. */
export interface ShapeFits {
  line: ShapeFit<LineGeometry> | null;
  rect: ShapeFit<RectGeometry> | null;
  ellipse: ShapeFit<EllipseGeometry> | null;
  arrow: ShapeFit<ArrowGeometry> | null;
}

/** The recogniser's answer: the winner, or the abstention, plus every fit behind it. */
export interface ShapeRecognition {
  shape: SnapShape;
  /** `null` exactly when `shape` is `"none"`. */
  fit: ShapeFit | null;
  /** What each primitive scored, so a caller can explain an abstention. */
  fits: ShapeFits;
}

/** Options for the pitch decimation the recogniser runs before any fit. */
export interface ResampleOptions {
  /**
   * Minimum distance between kept samples, in 0.1 mm.
   *
   * A 240 Hz pen at writing speed produces a sample every 0.2–1 mm, so a
   * 2-unit (0.2 mm) floor drops the sub-nib duplicates without moving the path:
   * the furthest any drawn point can be from the decimated path is half a
   * sample, well inside every band above. The unit matters — a pixel-based
   * threshold would decimate a zoomed-out page into nonsense (§6.2.5's unit
   * trap, one layer up).
   */
  minSpacing?: number;
}

/** The default decimation floor: 0.2 mm. */
export const SHAPE_RESAMPLE_SPACING = 2;

/* -------------------------------------------------------------------------
 * Reading a path
 * ---------------------------------------------------------------------- */

/** The `[x, y]` pairs of a flat path, rounded to the integers the format stores. */
export function snapPoints(path: SnapPath): SnapPoint[] {
  const points: SnapPoint[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    const x = path[i];
    const y = path[i + 1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([Math.round(x), Math.round(y)]);
  }
  return points;
}

/** The box a set of points occupies, or `null` when there are none. */
export function snapBounds(points: readonly SnapPoint[]): SnapBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * A path decimated to a minimum pitch, endpoints kept.
 *
 * The recogniser's fits are all means over the samples, so a stroke captured at
 * 240 Hz weighs its slow parts five times as heavily as its fast ones; decimating
 * by distance removes that bias as well as the cost. Endpoints are kept exactly,
 * because the whole module's contract is that the snapped mark starts and stops
 * where the pen did.
 */
export function resamplePath(
  path: SnapPath,
  options: ResampleOptions = {},
): SnapPoint[] {
  const spacing = Math.max(0, options.minSpacing ?? SHAPE_RESAMPLE_SPACING);
  const points = snapPoints(path);
  if (points.length <= 2 || spacing <= 0) return points;
  const kept: SnapPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    const last = kept[kept.length - 1]!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing)
      kept.push(point);
  }
  const end = points[points.length - 1]!;
  const last = kept[kept.length - 1]!;
  if (end[0] !== last[0] || end[1] !== last[1]) kept.push(end);
  return kept;
}

/** Total distance walked along a path, in 0.1 mm. */
export function pathLength(points: readonly SnapPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(
      points[i]![0] - points[i - 1]![0],
      points[i]![1] - points[i - 1]![1],
    );
  }
  return total;
}

/** The diagonal of a point set's box — the size every threshold here is a fraction of. */
export function boundingSpan(bounds: SnapBounds): number {
  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

/**
 * Whether a path has enough in it to be a shape at all.
 *
 * Exported because the call site needs the same answer *before* it starts the
 * 400 ms hold timer: a mark too small to snap should not light up a preview. The
 * two rules are §6.3's own — enough samples to carry a direction, and a span
 * big enough that a fit is a claim about intent rather than about noise.
 */
export function isSnappablePath(path: SnapPath): boolean {
  const points = resamplePath(path);
  if (points.length < SHAPE_MIN_POINTS) return false;
  const bounds = snapBounds(points);
  return bounds !== null && boundingSpan(bounds) >= SHAPE_MIN_SPAN;
}

/* -------------------------------------------------------------------------
 * Line
 * ---------------------------------------------------------------------- */

/**
 * Least-squares line through a point set, as `(direction, centroid)`.
 *
 * Total least squares rather than `y = mx + c`: a vertical line is a perfectly
 * good line and an infinite slope is not, and a hand-drawn one is never exactly
 * axis-aligned anyway. The direction is the first principal axis of the
 * covariance, which is the eigenvector the two-by-two case writes in closed
 * form — one pass to accumulate, one square root to orient it.
 */
export function principalAxis(points: readonly SnapPoint[]): {
  cx: number;
  cy: number;
  dirX: number;
  dirY: number;
  major: number;
  minor: number;
} {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // The two eigenvalues of [[sxx, sxy], [sxy, syy]] along that angle: the
  // variance along the axis and across it. Their square roots — the *spreads*,
  // one standard deviation of the samples each way — are what a line's width and
  // an ellipse's proportions are read from. They are deliberately not scaled
  // into semi-axes here: the factor between a closed curve's spread and its
  // radius is √2, but it is the curve's own business, so the conversion belongs
  // in the ellipse fit, which knows what it is measuring, and not in a helper
  // that is also used to find a line's direction.
  const major = Math.sqrt(
    Math.max(0, sxx * cos * cos + 2 * sxy * cos * sin + syy * sin * sin),
  );
  const minor = Math.sqrt(
    Math.max(0, sxx * sin * sin - 2 * sxy * cos * sin + syy * cos * cos),
  );
  return { cx, cy, dirX: cos, dirY: sin, major, minor };
}

/**
 * Mean distance from a point set to a distance function, in 0.1 mm.
 *
 * The one metric every fit reports, which is what makes the residuals
 * comparable: a rectangle's average distance to its outline can be set against
 * an ellipse's average distance to its curve, and the smaller one is the shape
 * the hand drew. A maximum would be the wrong statistic — one stray sample from
 * a pen slip would disqualify a good fit — and a sum would make the score depend
 * on how fast the user happened to write.
 */
export function meanDeviation(
  points: readonly SnapPoint[],
  distance: (x: number, y: number) => number,
): number {
  let total = 0;
  for (const [x, y] of points) total += distance(x, y);
  return total / points.length;
}

/** Confidence from a residual and the limit it had to stay under. */
export function confidenceOf(error: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - error / limit));
}


