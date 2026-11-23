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
 */

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

/** `curve.rs`'s `ink_tangent_at`: Catmull-Rom's direction, the span's length. */
function tangentAt(points: readonly number[][], i: number, side: Side): [number, number] {
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
  const sx = px + nx;
  const sy = py + ny;
  const sl = Math.hypot(sx, sy);
  if (!(sl > 0)) return [0, 0];
  const magnitude = side === "out" ? nl : pl;
  return [(sx / sl) * magnitude, (sy / sl) * magnitude];
}

/**
 * The stroke with every span longer than HERMITE_MIN_SPAN cut into equal steps of `u`
 * along its Hermite curve, the pressure interpolated linearly. The stored
 * points are all kept, unmoved.
 */
export function densifyHermite(
  points: readonly number[][],
  pressures: readonly number[],
  step = HERMITE_STEP,
): { points: number[][]; pressures: number[] } {
  const outPoints: number[][] = [];
  const outPressures: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    outPoints.push(points[i]!);
    outPressures.push(pressures[i]!);
    if (i + 1 >= points.length) break;
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const length = Math.hypot(bx! - ax!, by! - ay!);
    if (!(length > HERMITE_MIN_SPAN)) continue;
    const pieces = Math.min(HERMITE_MAX_PIECES, Math.ceil(length / step));
    const m1 = tangentAt(points, i, "out");
    const m2 = tangentAt(points, i + 1, "in");
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
    }
  }
  return { points: outPoints, pressures: outPressures };
}
