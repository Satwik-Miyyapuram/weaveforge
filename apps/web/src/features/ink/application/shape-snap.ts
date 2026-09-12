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
export type SnapGeometry = LineGeometry | RectGeometry | EllipseGeometry | ArrowGeometry;

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
export function resamplePath(path: SnapPath, options: ResampleOptions = {}): SnapPoint[] {
  const spacing = Math.max(0, options.minSpacing ?? SHAPE_RESAMPLE_SPACING);
  const points = snapPoints(path);
  if (points.length <= 2 || spacing <= 0) return points;
  const kept: SnapPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    const last = kept[kept.length - 1]!;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= spacing) kept.push(point);
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
    total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
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
function principalAxis(points: readonly SnapPoint[]): {
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
  const major = Math.sqrt(Math.max(0, sxx * cos * cos + 2 * sxy * cos * sin + syy * sin * sin));
  const minor = Math.sqrt(Math.max(0, sxx * sin * sin - 2 * sxy * cos * sin + syy * cos * cos));
  return { cx, cy, dirX: cos, dirY: sin, major, minor };
}

/**
 * Fit a line, or refuse because the mark is not one.
 *
 * Three refusals before any residual is computed, because each is a *shape* fact
 * the residual cannot express:
 *
 * 1. **Enough samples and enough span** (§6.3's "rough line" needs something to
 *    be rough about).
 * 2. **No significant back-tracking** ({@link LINE_BACKTRACK_LIMIT}) and **no
 *    sharp fold** ({@link LINE_MIN_SEGMENT_COS}). This is the arrow rule: an
 *    arrow's head retraces the shaft, so it is refused here and has to come
 *    through {@link fitArrow}, where its proportions are actually tested.
 * 3. **The samples really are collinear**, within {@link LINE_ERROR_LIMIT}.
 *
 * The fitted endpoints are the user's first and last samples, kept exactly. The
 * *direction* comes from the fit, so the interior points are projected onto the
 * fitted line: the mark straightens without the ends creeping, which is the
 * contract at the top of this module.
 */
export function fitLine(path: SnapPath, options: ResampleOptions = {}): ShapeFit<LineGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < SHAPE_MIN_POINTS) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const { cx, cy, dirX, dirY } = principalAxis(points);

  // Projection of each sample along the fitted direction, and the worst
  // *backward* step between consecutive projections. Two samples at the same
  // place project to the same number and contribute nothing.
  const projections = points.map(([x, y]) => (x - cx) * dirX + (y - cy) * dirY);
  let backtrack = 0;
  let worstCos = 1;
  for (let i = 1; i < points.length; i += 1) {
    backtrack = Math.max(backtrack, projections[i - 1]! - projections[i]!);
    const ax = points[i]![0] - points[i - 1]![0];
    const ay = points[i]![1] - points[i - 1]![1];
    const a = Math.hypot(ax, ay);
    if (a < 1e-9) continue;
    if (i + 1 >= points.length) continue;
    const bx = points[i + 1]![0] - points[i]![0];
    const by = points[i + 1]![1] - points[i]![1];
    const b = Math.hypot(bx, by);
    if (b < 1e-9) continue;
    worstCos = Math.min(worstCos, (ax * bx + ay * by) / (a * b));
  }
  if (backtrack > LINE_BACKTRACK_LIMIT * span) return null;
  if (worstCos < LINE_MIN_SEGMENT_COS) return null;

  const error = meanDeviation(points, (x, y) => Math.abs((x - cx) * -dirY + (y - cy) * dirX)) / span;
  if (error > LINE_ERROR_LIMIT) return null;

  const at = (point: SnapPoint): SnapPoint => {
    const t = (point[0] - cx) * dirX + (point[1] - cy) * dirY;
    return [Math.round(cx + dirX * t), Math.round(cy + dirY * t)];
  };
  const start = at(first);
  const end = at(last);
  return {
    shape: "line",
    error,
    confidence: confidenceOf(error, LINE_ERROR_LIMIT),
    geometry: { kind: "line", start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]) },
  };
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
function meanDeviation(
  points: readonly SnapPoint[],
  distance: (x: number, y: number) => number,
): number {
  let total = 0;
  for (const [x, y] of points) total += distance(x, y);
  return total / points.length;
}

/** Confidence from a residual and the limit it had to stay under. */
function confidenceOf(error: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - error / limit));
}

/* -------------------------------------------------------------------------
 * Rectangle
 * ---------------------------------------------------------------------- */

/**
 * Fit an axis-aligned rectangle, or refuse.
 *
 * The frame is the box of **smallest area** that contains the mark, found by
 * rotating-calipers search — not the principal-axis frame, which is what a first
 * reading of "axis alignment" suggests and which is wrong for the interesting
 * case. A square's principal axis runs along its *diagonal*, so in that frame the
 * square's extent box is a diamond whose corners have nothing to do with the
 * square's, and a rectangle drawn at 20° would be measured against a shape the
 * user never drew. The minimum-area box of any rectangle *is* that rectangle —
 * this is the classical result the rotating-calipers algorithm exists for — so
 * the same code fits an axis-aligned box and a deliberately rotated one, and the
 * rotation it reports is the mark's own lean. {@link recogniseShape} is what then
 * refuses a lean past {@link RECT_TILT_LIMIT_DEGREES}, which keeps "I drew this
 * straight" and "I drew this at an angle" apart.
 *
 * The search is over candidate angles seeded from each side's own direction and
 * refined in between: an exact search would need the convex hull, and a hull of
 * a hand-drawn closed path is a data structure built for no gain when the band
 * test below is forgiving of a fraction of a degree either way.
 *
 * Acceptance, after the frame: the mark must close ({@link CLOSED_GAP_LIMIT}),
 * must be walked at least {@link RECT_MIN_PERIMETER_RATIO} times its diagonal
 * (which is what stops an arrow — see {@link fitArrow}), must average within
 * {@link RECT_BAND_LIMIT} of the fitted box's outline, and must spend
 * {@link RECT_CORNER_SUPPORT} of its samples near the four corners, which is
 * what separates a rough box from a rough circle: a circle tracks its box's
 * sides but visits no corner.
 */
export function fitRect(path: SnapPath, options: ResampleOptions = {}): ShapeFit<RectGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < 4) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) > CLOSED_GAP_LIMIT * span) return null;
  if (pathLength(points) < RECT_MIN_PERIMETER_RATIO * span) return null;

  const box = minimumAreaBox(points);
  if (!box) return null;
  const { angle, ux, uy, vx, vy, minU, maxU, minV, maxV } = box;
  const width = maxU - minU;
  const height = maxV - minV;
  if (width <= 0 || height <= 0) return null;
  // A rectangle needs two axes as well as an ellipse does, and for the same
  // reason: the minimum-area box of a straight line is the line itself, with a
  // height of zero and four corners on top of each other, and its outline passes
  // through every sample — a perfect fit of a shape nobody drew. A square sits
  // at 1.0 and the flattest thing worth calling a box is about 1:4.
  if (Math.min(width, height) / Math.max(width, height) < RECT_MIN_MINOR_RATIO) return null;

  // Mean distance to the box outline, measured *in the box's own frame* so a
  // corner that overshot costs how far it overshot. The larger of the two signed
  // gaps is negative inside the box and positive outside; clamping at zero says
  // a sample anywhere inside is on the outline, which is right for a shape whose
  // renderer strokes the outline and does not fill it.
  const local: Array<readonly [number, number]> = points.map(([x, y]) => [
    x * ux + y * uy,
    x * vx + y * vy,
  ]);
  const error =
    meanDeviation(local, (u, v) => {
      const du = Math.max(minU - u, u - maxU);
      const dv = Math.max(minV - v, v - maxV);
      return Math.max(0, Math.max(du, dv));
    }) / span;
  if (error > RECT_BAND_LIMIT) return null;

  const toPage = (u: number, v: number): SnapPoint => [
    Math.round(u * ux + v * vx),
    Math.round(u * uy + v * vy),
  ];
  const rawCorners: SnapPoint[] = [
    toPage(minU, minV),
    toPage(maxU, minV),
    toPage(maxU, maxV),
    toPage(minU, maxV),
  ];

  const cornerBand = RECT_CORNER_BAND * Math.max(width, height);
  let nearCorner = 0;
  for (const [x, y] of points) {
    for (const corner of rawCorners) {
      if (Math.hypot(x - corner[0], y - corner[1]) <= cornerBand) {
        nearCorner += 1;
        break;
      }
    }
  }
  if (nearCorner / points.length < RECT_CORNER_SUPPORT) return null;

  // Walk the corners from the one nearest the pen's own first sample, in the
  // direction the pen travelled. That is what keeps the seam where the user
  // started: the snapped path grows from the same place as the mark it replaces.
  let startIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < rawCorners.length; i += 1) {
    const corner = rawCorners[i]!;
    const distance = Math.hypot(corner[0] - first[0], corner[1] - first[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      startIndex = i;
    }
  }
  const towardLast = (index: number): number => {
    const corner = rawCorners[index]!;
    return Math.hypot(corner[0] - last[0], corner[1] - last[1]);
  };
  const next = (startIndex + 1) % rawCorners.length;
  const previous = (startIndex + rawCorners.length - 1) % rawCorners.length;
  const clockwise = towardLast(next) <= towardLast(previous);
  const corners: SnapPoint[] = [];
  for (let i = 0; i < rawCorners.length; i += 1) {
    const offset = clockwise ? i : -i;
    corners.push(rawCorners[(startIndex + offset + rawCorners.length) % rawCorners.length]!);
  }

  return {
    shape: "rect",
    error,
    confidence: confidenceOf(error, RECT_BAND_LIMIT),
    geometry: { kind: "rect", corners, closed: true, rotationDegrees: normaliseAxisDegrees(angle) },
  };
}

/**
 * The smallest-area box containing a point set, as a frame plus its extremes.
 *
 * The rotating-calipers idea without the convex hull: the minimum-area rectangle
 * around a point set always has a side flush with one of the set's edges, so the
 * candidate angles are the directions of the mark's own sides. Each candidate is
 * scored by the area of the axis-aligned extent of the points rotated into it,
 * and the best candidate is refined by a short bisection between it and its
 * neighbours. A hand-drawn box's sides are within a couple of degrees of each
 * other, so seeding from every K-th side and refining catches the true minimum
 * without a hull.
 *
 * The frame is returned as *unit* axis vectors — `(ux, uy)` and `(vx, vy)` — in
 * page space, with the extents along each. That is all the caller needs: a point
 * projects to `(x·ux + y·uy, x·vx + y·vy)` and a frame coordinate maps back to
 * the page with `u·(ux, uy) + v·(vx, vy)`, so no origin bookkeeping is needed
 * anywhere and the box's corners are just the four combinations of the extremes.
 */
function minimumAreaBox(points: readonly SnapPoint[]): {
  angle: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
} | null {
  const candidates: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    candidates.push(Math.atan2(points[i]![1] - points[i - 1]![1], points[i]![0] - points[i - 1]![0]));
  }
  if (candidates.length === 0) return null;

  // Score every candidate, then bisect between the winner and each neighbour. The
  // extents are compared by area, and the box is described by a rotated frame so
  // the caller never sees an angle twice.
  const extentAt = (angle: number) => {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of points) {
      const u = x * ux + y * uy;
      const v = x * vx + y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    return { ux, uy, vx, vy, minU, maxU, minV, maxV, area: (maxU - minU) * (maxV - minV) };
  };

  // Score every candidate, keep the tightest, then refine it on each side by a
  // golden-section search. That places the box within a hundredth of a degree —
  // two orders of magnitude under the corner band the fit is judged by, so the
  // search itself can never be what decides an acceptance.
  let bestAngle = candidates[0]!;
  let best = extentAt(bestAngle);
  for (const candidate of candidates) {
    const extent = extentAt(candidate);
    if (extent.area < best.area) {
      best = extent;
      bestAngle = candidate;
    }
  }

  const golden = (Math.sqrt(5) - 1) / 2;
  for (const direction of [-1, 1]) {
    let low = 0;
    let high = Math.PI / 2;
    let x1 = high - golden * (high - low);
    let x2 = low + golden * (high - low);
    let f1 = extentAt(bestAngle + direction * x1);
    let f2 = extentAt(bestAngle + direction * x2);
    for (let i = 0; i < 32; i += 1) {
      if (f1.area < f2.area) {
        high = x2;
        x2 = x1;
        f2 = f1;
        x1 = high - golden * (high - low);
        f1 = extentAt(bestAngle + direction * x1);
      } else {
        low = x1;
        x1 = x2;
        f1 = f2;
        x2 = low + golden * (high - low);
        f2 = extentAt(bestAngle + direction * x2);
      }
    }
    const refinedAngle = bestAngle + (direction * (low + high)) / 2;
    const refined = extentAt(refinedAngle);
    if (refined.area < best.area) {
      best = refined;
      bestAngle = refinedAngle;
    }
  }

  return {
    angle: bestAngle,
    ux: best.ux,
    uy: best.uy,
    vx: best.vx,
    vy: best.vy,
    minU: best.minU,
    maxU: best.maxU,
    minV: best.minV,
    maxV: best.maxV,
  };
}

/**
 * A rotation folded into `[0°, 45°]`, because a rectangle's axes are unordered.
 *
 * A box rotated by 90° is the same box with its long side relabelled, and the
 * principal axis can come out pointing either way along each of the two axes, so
 * the raw angle of the fit is `θ`, `θ + 90`, `θ − 90` or `θ + 180` depending on
 * which corner the covariance happened to favour. Folding all four onto the same
 * answer is what makes the tilt threshold mean "how far off the page axes is
 * this box" rather than "which way did the eigenvectors happen to fall".
 */
function normaliseAxisDegrees(degrees: number): number {
  const wrapped = ((degrees % 90) + 90) % 90;
  return wrapped > 45 ? 90 - wrapped : wrapped;
}

/* -------------------------------------------------------------------------
 * Ellipse
 * ---------------------------------------------------------------------- */

/**
 * Fit a centred ellipse, or refuse because the mark is not one.
 *
 * A moment fit, not an algebraic conic fit: the centre is the centroid and the
 * axes are the principal spreads, which costs one pass and cannot produce the
 * degenerate hyperbolas a least-squares conic does on a short arc. It is also
 * the fit the words "eccentricity of the point distribution around the centroid"
 * in §6.4 step 8's neighbourhood actually describe — a tilted circle is a
 * perfectly good circle, and a fit that forced the page axes would call it a
 * 1.4:1 ellipse with an ugly residual.
 *
 * Two gates, in this order, because they are what keeps a rough square out:
 *
 * 1. **There must be two axes at all** ({@link ELLIPSE_MIN_ECCENTRICITY}).
 * 2. **The radial residual must be small** ({@link ELLIPSE_ERROR_LIMIT}). A
 *    square's radial profile runs from its inradius to its circumradius — a
 *    factor of √2 — so its residual is an order of magnitude over the limit,
 *    while a hand-drawn circle's is a few per cent. The residual is measured
 *    *along each sample's own ray*, which is the correct distance for a radial
 *    profile and the one that stays finite for a very flat ellipse.
 */
export function fitEllipse(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFit<EllipseGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < 5) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) > ELLIPSE_GAP_LIMIT * span) return null;

  const { cx, cy, dirX, dirY, major, minor } = principalAxis(points);
  if (major <= 0 || minor <= 0) return null;
  if (minor / major < ELLIPSE_MIN_AXIS_RATIO) return null;

  // A closed curve's *spread* is its semi-axis over √2 — the variance of the
  // points of a circle of radius R about its centre is R²/2 in every direction —
  // so the semi-axes have to be put back before anything is drawn or measured.
  // Skipping this is a silent bug of exactly √2: the fit looks like a circle and
  // covers 71 % of the mark the user drew, and the shortcut is invisible because
  // the residual is computed in the same wrong units in which it is reported.
  const radiusMajor = major * Math.SQRT2;
  const radiusMinor = minor * Math.SQRT2;

  const ux = -dirY;
  const uy = dirX;
  // Distance from a sample to the ellipse, measured along the sample's own ray:
  // `r` is the sample's radius as a fraction of the radius the ellipse has in
  // that direction, so `|r − 1|` is the radial error and multiplying by the
  // semi-major axis puts it back into 0.1 mm, where every other residual lives.
  const unit = (x: number, y: number): number => {
    const u = (x - cx) * dirX + (y - cy) * dirY;
    const v = (x - cx) * ux + (y - cy) * uy;
    const r = Math.hypot(u / radiusMajor, v / radiusMinor);
    return r <= 0 ? radiusMajor : Math.abs(r - 1) * radiusMajor;
  };
  const error = meanDeviation(points, unit) / radiusMajor;
  if (error > ELLIPSE_ERROR_LIMIT) return null;

  // The modulation is what tells a circle from an ellipse: how far the samples
  // swing between the axes, as a fraction of the mean radius. Uniform radii mean
  // a circle whatever the covariance says, which is the robust reading of "is
  // this round".
  let radiusSum = 0;
  let radiusMin = Infinity;
  let radiusMax = 0;
  for (const [x, y] of points) {
    const u = (x - cx) * dirX + (y - cy) * dirY;
    const v = (x - cx) * ux + (y - cy) * uy;
    const radius = Math.hypot(u, v);
    radiusSum += radius;
    if (radius < radiusMin) radiusMin = radius;
    if (radius > radiusMax) radiusMax = radius;
  }
  const meanRadius = radiusSum / points.length;
  const modulation = meanRadius > 0 ? (radiusMax - radiusMin) / meanRadius : 0;

  return {
    shape: "ellipse",
    error,
    confidence: confidenceOf(error, ELLIPSE_ERROR_LIMIT),
    geometry: {
      kind: "ellipse",
      // The centre is projected out of the covariance's own frame, so the fitted
      // curve and the drawn mark share a centre even when the mark is a hand's
      // worth of off-centre.
      centre: [Math.round(cx), Math.round(cy)],
      radiusX: Math.round(radiusMajor),
      radiusY: Math.round(radiusMinor),
      rotationDegrees: (Math.atan2(dirY, dirX) * 180) / Math.PI,
      circle: modulation <= CIRCLE_MODULATION,
    },
  };
}

/* -------------------------------------------------------------------------
 * Arrow
 * ---------------------------------------------------------------------- */

/**
 * Fit an arrow — a long shaft and a short head — or refuse.
 *
 * The tip is the last point the pen reached on its way *out*: the last local
 * maximum of the distance from where it went down. That is the honest reading of
 * "an arrow" — the pen travels away from its start and comes back only to form
 * the barbs — and it is deliberately not "the sample furthest from the start",
 * which a retraced head contradicts: a hand that draws the first barb, the tip,
 * the second barb and then returns to the tip along the shaft leaves its final
 * sample on the tip, so the farthest sample and the turning point are different
 * indices. (The tip's *endpoint* also has to be the outermost sample of the head;
 * that, not the index, is what "the barbs lie behind it" means.)
 *
 * Everything after that turning point is the head, and the three tests are the
 * three things that make a "head" a head rather than a wobble:
 *
 * 1. **The head is long enough to see** ({@link ARROW_MIN_HEAD_REACH}) — a flick
 *    at the end of a line is a line.
 * 2. **The pen travelled further than the distance it covered**
 *    ({@link ARROW_MIN_PATH_RATIO}) — a straight stroke's path *is* its span, and
 *    an arrow's is span plus its barbs, which is the cheapest possible test that
 *    something doubled back. It is also the rectangle's mirror: a rectangle is
 *    2× its diagonal, an arrow barely over 1×.
 * 3. **Two barbs open into a V** ({@link ARROW_MIN_OPENING_DEGREES} to
 *    {@link ARROW_MAX_OPENING_DEGREES}), none of them past the tip
 *    ({@link ARROW_MAX_HEAD_RATIO}), and the shaft behind them straight enough
 *    ({@link ARROW_SHAFT_ERROR_LIMIT}) that it is a shaft and not a second bend.
 *
 * The returned geometry keeps the shaft and the head as *separate* paths. That
 * is not cosmetic: the samples retrace the last stretch of shaft to reach the
 * second barb, and drawing one polyline through them would paint that stretch
 * twice and leave a bead at the fold (§6.2.3's stencil dedupe is for
 * highlighter, not for a pen).
 */
export function fitArrow(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFit<ArrowGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < 4) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  // The tip is the sample the pen travelled furthest to reach *before* it turned
  // back: the last local maximum of the distance from where the pen went down.
  // It is not simply the farthest sample. A hand drawing an arrow works back
  // along the shaft to draw the second barb, and a *retraced* head — the common
  // case, where the pen returns to the tip along the shaft — has its final sample
  // sitting on the tip again, so "farthest" and "tip" disagree by an index.
  const start = points[0]!;
  const reach = points.map(([x, y]) => Math.hypot(x - start[0], y - start[1]));
  let tipIndex = -1;
  for (let i = 1; i + 1 < points.length; i += 1) {
    if (reach[i]! > reach[i - 1]! && reach[i]! >= reach[i + 1]!) tipIndex = i;
  }
  // eslint-disable-next-line no-console
  if (tipIndex < 0) return null;
  const farthest = reach[tipIndex]!;
  // The shaft has to be a shaft and the head has to be a head: at least two
  // samples before the tip to give it a direction, and at least two after it for
  // the barbs. A head of exactly two samples is therefore accepted, which is the
  // minimum a real arrow can have.
  if (tipIndex < 2 || tipIndex > points.length - 3) {
    return null;
  }
  if (farthest < ARROW_MIN_HEAD_REACH * span) {
    return null;
  }

  // Every head sample must lie *behind* the tip: a barb is a step back toward
  // where the pen started, never further out than the point it springs from.
  // That is what makes this an arrow and not a mark that simply wanders.
  const tip = points[tipIndex]!;
  const head = points.slice(tipIndex + 1);
  const headReach = Math.max(...head.map(([x, y]) => Math.hypot(x - start[0], y - start[1])));
  if (headReach > farthest * ARROW_MAX_HEAD_RATIO) {
    return null;
  }
  if (pathLength(points) < ARROW_MIN_PATH_RATIO * farthest) {
    return null;
  }

  // The shaft is everything up to the tip, plus the tip itself: a fitted line
  // through those samples, exactly as `fitLine` would, but with the back-tracking
  // rule deliberately absent — the back-tracking *is* the arrow.
  const shaft = points.slice(0, tipIndex + 1);
  const { cx, cy, dirX, dirY } = principalAxis(shaft);
  const shaftError =
    meanDeviation(shaft, (x, y) => Math.abs((x - cx) * -dirY + (y - cy) * dirX)) / farthest;
  if (shaftError > ARROW_SHAFT_ERROR_LIMIT) return null;

  // eslint-disable-next-line no-console
  const project = (x: number, y: number): SnapPoint => {
    const t = (x - cx) * dirX + (y - cy) * dirY;
    return [Math.round(cx + dirX * t), Math.round(cy + dirY * t)];
  };
  const base = project(start[0], start[1]);
  const shaftTip = project(tip[0], tip[1]);

  // The barbs' vertices: the two head samples that swing widest off the shaft,
  // which is where a hand-drawn head's points are even when the two strokes
  // differ in length. Ordering them by the cross product puts them in the order
  // the pen met them, so the head path is replayable.
  const toTipX = tip[0] - base[0];
  const toTipY = tip[1] - base[1];
  const toTipLength = Math.hypot(toTipX, toTipY);
  if (toTipLength <= 0) return null;
  const nx = -toTipY / toTipLength;
  const ny = toTipX / toTipLength;
  let widest = -1;
  let widestOffset = 0;
  let second = -1;
  let secondOffset = 0;
  for (let i = 0; i < head.length; i += 1) {
    const offset = (head[i]![0] - base[0]) * nx + (head[i]![1] - base[1]) * ny;
    const magnitude = Math.abs(offset);
    if (magnitude > widestOffset) {
      second = widest;
      secondOffset = widestOffset;
      widest = i;
      widestOffset = magnitude;
    } else if (magnitude > secondOffset) {
      second = i;
      secondOffset = magnitude;
    }
  }
  if (widest < 0 || second < 0) return null;
  const firstBarb = head[Math.min(widest, second)]!;
  const secondBarb = head[Math.max(widest, second)]!;

  const opening = openingDegrees(tip, firstBarb, secondBarb);
  // eslint-disable-next-line no-console
  if (opening < ARROW_MIN_OPENING_DEGREES || opening > ARROW_MAX_OPENING_DEGREES) return null;

  return {
    shape: "arrow",
    error: shaftError,
    confidence: confidenceOf(shaftError, ARROW_SHAFT_ERROR_LIMIT),
    geometry: {
      kind: "arrow",
      start: base,
      tip: shaftTip,
      head: [firstBarb, secondBarb],
      shaftPath: [base, shaftTip],
      headPath: [shaftTip, firstBarb, shaftTip, secondBarb],
    },
  };
}

/** The angle a tip's two barbs open through, in degrees. `0` when either is degenerate. */
function openingDegrees(tip: SnapPoint, a: SnapPoint, b: SnapPoint): number {
  const ax = a[0] - tip[0];
  const ay = a[1] - tip[1];
  const bx = b[0] - tip[0];
  const by = b[1] - tip[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la <= 0 || lb <= 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------
 * Choosing between the fits
 * ---------------------------------------------------------------------- */

/** Every primitive's fit, in one pass, for a caller that wants to explain itself. */
export function fitAllShapes(path: SnapPath, options: ResampleOptions = {}): ShapeFits {
  return {
    line: fitLine(path, options),
    rect: fitRect(path, options),
    ellipse: fitEllipse(path, options),
    arrow: fitArrow(path, options),
  };
}

/**
 * The one recogniser §6.3's Shape tool calls.
 *
 * The rule, in full, and the reason every threshold above exists:
 *
 * 1. Fit all four primitives ({@link fitAllShapes}). Each refuses outright when
 *    the mark cannot be that shape at all, so a scribble usually produces no
 *    candidates and abstention is the *common* answer, not a fallback.
 * 2. A rectangle leaning more than {@link RECT_TILT_LIMIT_DEGREES} off the page
 *    axes is dropped here rather than in the fit, because
 *    {@link fitRect} reports the lean and only the tool knows the page is
 *    upright.
 * 3. The lowest residual wins, and it must beat its closest rival by
 *    {@link SHAPE_ACCEPT_MARGIN} of its own residual and clear
 *    {@link SHAPE_MIN_CONFIDENCE}. Ties are broken in the order §6.3 lists the
 *    shapes — line, rect, ellipse, arrow — so the answer is deterministic for a
 *    symmetric mark.
 *
 * The `fits` on the result are the *unfiltered* candidates, so the UI can say
 * "nearly a rectangle" when it abstains, and the tests can assert on the
 * geometry that lost.
 */
export function recogniseShape(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeRecognition {
  const fits = fitAllShapes(path, options);
  const candidates: ShapeFit[] = [];
  if (fits.line) candidates.push(fits.line);
  if (fits.rect && fits.rect.geometry.rotationDegrees <= RECT_TILT_LIMIT_DEGREES) {
    candidates.push(fits.rect);
  }
  if (fits.ellipse) candidates.push(fits.ellipse);
  if (fits.arrow) candidates.push(fits.arrow);

  if (candidates.length === 0) return { shape: "none", fit: null, fits };

  let best = candidates[0]!;
  let secondBest = Infinity;
  for (const candidate of candidates.slice(1)) {
    if (candidate.error < best.error) {
      secondBest = best.error;
      best = candidate;
    } else if (candidate.error < secondBest) {
      secondBest = candidate.error;
    }
  }

  const beatsRival =
    secondBest === Infinity || best.error <= secondBest * (1 - SHAPE_ACCEPT_MARGIN);
  if (!beatsRival || best.confidence < SHAPE_MIN_CONFIDENCE) {
    return { shape: "none", fit: null, fits };
  }
  return { shape: best.shape, fit: best, fits };
}

/* -------------------------------------------------------------------------
 * The path the renderer draws
 * ---------------------------------------------------------------------- */

/**
 * A fitted shape as a path the renderer can draw, endpoints kept.
 *
 * One function rather than a `switch` at every call site, and the place the
 * endpoint contract is enforced: whichever primitive was fitted, the first point
 * here is the user's first sample (for a closed shape, the fitted vertex nearest
 * it) and the last point is the user's last sample. A rect and an ellipse are
 * closed only when the mark closed — the flag says so and the caller decides
 * whether to stroke a `Z`.
 *
 * An arrow answers with its **shaft**; {@link fittedArrowPaths} gives both
 * halves, and the head is a separate path for the reason in {@link fitArrow}.
 */
export function fittedInkPath(geometry: SnapGeometry): SnapPoint[] {
  switch (geometry.kind) {
    case "line":
      return [geometry.start, geometry.end];
    case "rect":
      return [...geometry.corners, geometry.corners[0]!];
    case "ellipse": {
      // A closed quadratic-ish ring at a fixed angular pitch. The renderer's own
      // curve fitting takes it from here; this is only the polyline form, and
      // its pitch is fine enough that a snapped ellipse's closest approach to
      // the drawn mark is far inside the confidence band the snap reported.
      const steps = ELLIPSE_PATH_STEPS;
      const rotation = (geometry.rotationDegrees * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const path: SnapPoint[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        const u = geometry.radiusX * Math.cos(angle);
        const v = geometry.radiusY * Math.sin(angle);
        path.push([
          Math.round(geometry.centre[0] + u * cos - v * sin),
          Math.round(geometry.centre[1] + u * sin + v * cos),
        ]);
      }
      return path;
    }
    case "arrow":
      return [...geometry.shaftPath];
  }
}

/** Segments a fitted ellipse's polyline form is sampled at: 64, one per 5.6°. */
export const ELLIPSE_PATH_STEPS = 64;

/**
 * An arrow as its two drawable sub-paths: the centreline, then the head.
 *
 * Drawn with the same nib, in this order, so the head sits on top of the shaft
 * exactly as the retrace would have put it there — without the double-blended
 * bead the single path would leave.
 */
export function fittedArrowPaths(geometry: ArrowGeometry): SnapPoint[][] {
  return [fittedInkPath(geometry), [...geometry.headPath]];
}
