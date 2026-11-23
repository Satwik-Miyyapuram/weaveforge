/**
 * Fills each long span of a stroke with points on the cubic Hermite curve the
 * stroke was stored against (crates/wf-core/src/ink/curve.rs, mirrored here so
 * the renderer needs no wasm call per point).
 *
 * Strokes saved before 0.9.5 were packed (stroke_packer.rs): only the samples
 * that keep that curve within tolerance of the pen were kept, a millimetre or
 * two apart round a letter loop. The freehand renderer joins its input points
 * with straight lines, so drawn as stored they show chords and corners. A raw
 * stroke, whose samples are closer than HERMITE_MIN_SPAN, is returned as it was.
 *
 * A stored point where the stroke turns by more than CORNER_DEGREES is a corner:
 * the curve leaves and enters it along the chords on each side, so an N, z or M
 * keeps its points instead of swinging round them, and the point is flagged so
 * the smoothing that follows leaves it in place.
 */
import { CORNER_DEGREES } from "./corner-smoothing";

/**
 * The longest span, in 0.1 mm, drawn as stored. A pen samples closer than this
 * at writing speed, so raw strokes (and their shake) draw exactly as before.
 */
export const HERMITE_MIN_SPAN = 3;
/** The length, in 0.1 mm, of each piece a longer span is cut into. */
export const HERMITE_STEP = 1;
/** The most pieces one span is cut into, so a pathological stroke stays cheap. */
export const HERMITE_MAX_PIECES = 32;

type Side = "in" | "out";

/**
 * `curve.rs`'s `ink_tangent_at`: Catmull-Rom's direction, the span's length.
 * At a corner, the chord on `side` alone.
 */
function tangentAt(points: readonly number[][], i: number, side: Side, corner: boolean): [number, number] {
  const [x, y] = points[i]!;
  const prev = i > 0 ? points[i - 1]! : undefined;
  const next = i + 1 < points.length ? points[i + 1]! : undefined;
  const px = prev ? x! - prev[0]! : 0;
  const py = prev ? y! - prev[1]! : 0;
  const nx = next ? next[0]! - x! : 0;
  const ny = next ? next[1]! - y! : 0;
  const pl = Math.hypot(px, py);
  const nl = Math.hypot(nx, ny);
  if (!(pl > 0) && !(nl > 0)) return [0, 0];
  if (!(pl > 0)) return [nx, ny];
  if (!(nl > 0)) return [px, py];
  if (corner) return side === "out" ? [nx, ny] : [px, py];
  const sx = px + nx;
  const sy = py + ny;
  const sl = Math.hypot(sx, sy);
  if (!(sl > 0)) return [0, 0];
  const magnitude = side === "out" ? nl : pl;
  return [(sx / sl) * magnitude, (sy / sl) * magnitude];
}

/** The turn, in degrees, of the stroke at each stored point; 0 at the ends. */
function storedTurns(points: readonly number[][]): number[] {
  return points.map((q, i) => {
    const p = points[i - 1];
    const r = points[i + 1];
    if (!p || !r) return 0;
    const ax = q[0]! - p[0]!;
    const ay = q[1]! - p[1]!;
    const bx = r[0]! - q[0]!;
    const by = r[1]! - q[1]!;
    const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (!(lengths > 0)) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / lengths))) * 180) / Math.PI;
  });
}

/**
 * True at each stored point that is a corner: it turns by more than
 * CORNER_DEGREES, and by at least twice as much as either neighbour. A packed
 * curve turns at every stored point (a 1 mm loop by up to 98 degrees, measured), a
 * corner turns alone.
 */
function storedCorners(points: readonly number[][]): boolean[] {
  const turns = storedTurns(points);
  return turns.map((t, i) => t > CORNER_DEGREES && t >= 2 * Math.max(turns[i - 1] ?? 0, turns[i + 1] ?? 0));
}

/**
 * The stroke with every span longer than HERMITE_MIN_SPAN cut into equal steps of `u`
 * along its Hermite curve, the pressure interpolated linearly. The stored
 * points are all kept, unmoved; `corners` flags the ones that are corners.
 */
export function densifyHermite(
  points: readonly number[][],
  pressures: readonly number[],
  step = HERMITE_STEP,
): { points: number[][]; pressures: number[]; corners: boolean[] } {
  const outPoints: number[][] = [];
  const outPressures: number[] = [];
  const outCorners: boolean[] = [];
  const corner = storedCorners(points);
  for (let i = 0; i < points.length; i += 1) {
    outPoints.push(points[i]!);
    outPressures.push(pressures[i]!);
    outCorners.push(corner[i]!);
    if (i + 1 >= points.length) break;
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const length = Math.hypot(bx! - ax!, by! - ay!);
    if (!(length > HERMITE_MIN_SPAN)) continue;
    const pieces = Math.min(HERMITE_MAX_PIECES, Math.ceil(length / step));
    const m1 = tangentAt(points, i, "out", corner[i]!);
    const m2 = tangentAt(points, i + 1, "in", corner[i + 1]!);
    const pa = pressures[i]!;
    const pb = pressures[i + 1]!;
    for (let k = 1; k < pieces; k += 1) {
      const u = k / pieces;
      const uu = u * u;
      const uuu = uu * u;
      const h00 = 2 * uuu - 3 * uu + 1;
      const h10 = uuu - 2 * uu + u;
      const h01 = -2 * uuu + 3 * uu;
      const h11 = uuu - uu;
      outPoints.push([
        h00 * ax! + h10 * m1[0] + h01 * bx! + h11 * m2[0],
        h00 * ay! + h10 * m1[1] + h01 * by! + h11 * m2[1],
      ]);
      outPressures.push(pa + (pb - pa) * u);
      outCorners.push(false);
    }
  }
  return { points: outPoints, pressures: outPressures, corners: outCorners };
}
