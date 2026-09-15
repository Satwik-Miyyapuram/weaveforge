import {
  CIRCLE_MODULATION,
  CLOSED_GAP_LIMIT,
  ELLIPSE_ERROR_LIMIT,
  ELLIPSE_GAP_LIMIT,
  ELLIPSE_MIN_AXIS_RATIO,
  SHAPE_MIN_POINTS,
  SHAPE_MIN_SPAN,
  boundingSpan,
  confidenceOf,
  meanDeviation,
  pathLength,
  principalAxis,
  resamplePath,
  snapBounds,
  snapPoints,
  type EllipseGeometry,
  type ResampleOptions,
  type ShapeFit,
  type SnapPath,
  type SnapPoint,
} from "./geometry";

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
  if (
    Math.hypot(last[0] - first[0], last[1] - first[1]) >
    ELLIPSE_GAP_LIMIT * span
  )
    return null;

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



