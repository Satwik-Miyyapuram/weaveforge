import {
  type SnapPath,
} from "./geometry";

import {
  RECT_TILT_LIMIT_DEGREES,
  SHAPE_ACCEPT_MARGIN,
  SHAPE_MIN_CONFIDENCE,
  type ArrowGeometry,
  type ResampleOptions,
  type ShapeFit,
  type ShapeFits,
  type ShapeRecognition,
  type SnapGeometry,
  type SnapPoint,
  type SnapShape,
} from "./geometry";
import { fitArrow } from "./arrow";
import { fitEllipse } from "./ellipse";
import { fitLine } from "./line";
import { fitRect } from "./rect";

/* -------------------------------------------------------------------------
 * Choosing between the fits
 * ---------------------------------------------------------------------- */

/** Every primitive's fit, in one pass, for a caller that wants to explain itself. */
export function fitAllShapes(
  path: SnapPath,
  options: ResampleOptions = {},
): ShapeFits {
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
  if (
    fits.rect &&
    fits.rect.geometry.rotationDegrees <= RECT_TILT_LIMIT_DEGREES
  ) {
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
    secondBest === Infinity ||
    best.error <= secondBest * (1 - SHAPE_ACCEPT_MARGIN);
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


