import {
  CLOSED_GAP_LIMIT,
  RECT_BAND_LIMIT,
  RECT_CORNER_BAND,
  RECT_CORNER_SUPPORT,
  RECT_MIN_MINOR_RATIO,
  RECT_MIN_PERIMETER_RATIO,
  SHAPE_MIN_SPAN,
  boundingSpan,
  confidenceOf,
  meanDeviation,
  pathLength,
  resamplePath,
  snapBounds,
  snapPoints,
  type RectGeometry,
  type ResampleOptions,
  type ShapeFit,
  type SnapPath,
  type SnapPoint,
} from "./geometry";

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
export function fitRect(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFit<RectGeometry> | null {
  const points = resamplePath(path, options);
  if (points.length < 4) return null;
  const bounds = snapBounds(points);
  if (!bounds) return null;
  const span = boundingSpan(bounds);
  if (span < SHAPE_MIN_SPAN) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (
    Math.hypot(last[0] - first[0], last[1] - first[1]) >
    CLOSED_GAP_LIMIT * span
  )
    return null;
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
  if (Math.min(width, height) / Math.max(width, height) < RECT_MIN_MINOR_RATIO)
    return null;

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
    corners.push(
      rawCorners[
        (startIndex + offset + rawCorners.length) % rawCorners.length
      ]!,
    );
  }

  return {
    shape: "rect",
    error,
    confidence: confidenceOf(error, RECT_BAND_LIMIT),
    geometry: {
      kind: "rect",
      corners,
      closed: true,
      rotationDegrees: normaliseAxisDegrees(angle),
    },
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
    candidates.push(
      Math.atan2(
        points[i]![1] - points[i - 1]![1],
        points[i]![0] - points[i - 1]![0],
      ),
    );
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
    return {
      ux,
      uy,
      vx,
      vy,
      minU,
      maxU,
      minV,
      maxV,
      area: (maxU - minU) * (maxV - minV),
    };
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


