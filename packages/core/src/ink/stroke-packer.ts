/**
 * Packing a stroke for storage while it is written: points are only appended,
 * so the stroke committed on lift is the last one drawn.
 */
import { inkCurveAt } from "./curve.js";
import {
  INK_COORD_LIMIT,
  INK_PACK_PRESSURE_TOLERANCE,
  INK_PACK_TOLERANCE,
  INK_STROKE_MAX_POINTS,
  pressureByte,
  type PackedInkStroke,
} from "./ink-note.js";

/**
 * Storage-ready form of one captured stroke, pressure included.
 *
 * The whole stroke pushed through an {@link InkStrokePacker}, so a stroke
 * packed at once is exactly the one the pen drew live. Fewer than two finite
 * samples is nothing to draw and packs to nothing; pressure of the wrong length
 * is ignored rather than misaligned.
 */
export function packInkStroke(
  points: readonly number[],
  pressures: readonly number[] = [],
  options: InkStrokePackerOptions = {},
): PackedInkStroke {
  const even = points.slice(0, Math.floor(points.length / 2) * 2);
  if (even.length < 4 || even.some((value) => !Number.isFinite(value))) {
    return { points: [], pressures: [] };
  }
  const usablePressures = pressures.length === even.length / 2 ? pressures : [];
  const packer = new InkStrokePacker(options);
  for (let i = 0; i < even.length / 2; i += 1) {
    packer.push(even[i * 2]!, even[i * 2 + 1]!, usablePressures[i]);
  }
  return packer.packed();
}

export interface InkStrokePackerOptions {
  tolerance?: number;
  maxPoints?: number;
  pressureTolerance?: number;
}

/** Chords a span is cut into when a sample is measured against its curve. */
const PACK_SPAN_STEPS = 16;

/**
 * Packs a stroke while it is written, keeping points only ever appended.
 *
 * Xournal++, tldraw and Excalidraw all add points as the pen moves and never
 * revisit them, so ink already on the page stays where it was drawn. This
 * does the same with fewer points: a sleeve in the manner of Lang's
 * simplification (1969) grows from the last kept sample, and the samples
 * inside it are measured against the curve that is actually drawn
 * ({@link inkCurveAt}), the error bound of Schneider's curve fitting
 * ("An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems,
 * 1990), with pressure held to a straight ramp within `pressureTolerance`.
 *
 * When a new sample no longer fits, one sample of the run is kept: the one
 * whose two spans fit with the least error. A span's curve reads the point
 * after its end, so the span behind the pen is checked again too, and no kept
 * point is ever moved. Only the last two spans can still turn as the pen goes
 * on; everything before them is final.
 *
 * Coordinates are rounded to whole 0.1 mm units and pressures to a byte,
 * which is what the container stores. At `maxPoints` the packer stops keeping
 * points and the stroke's end follows the pen.
 */
export class InkStrokePacker {
  private readonly tolerance: number;
  private readonly maxPoints: number;
  private readonly pressureTolerance: number;
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly ps: number[] = [];
  private readonly kept: number[] = [];
  private readonly curveX = new Float64Array(PACK_SPAN_STEPS + 1);
  private readonly curveY = new Float64Array(PACK_SPAN_STEPS + 1);

  constructor(options: InkStrokePackerOptions = {}) {
    this.tolerance = options.tolerance ?? INK_PACK_TOLERANCE;
    this.maxPoints = Math.max(2, options.maxPoints ?? INK_STROKE_MAX_POINTS);
    this.pressureTolerance = options.pressureTolerance ?? INK_PACK_PRESSURE_TOLERANCE;
  }

  /** Add the pen's next sample, in 0.1 mm, with its 0–255 pressure if it has one. A non-finite one is skipped. */
  push(x: number, y: number, pressure?: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const c = this.xs.length;
    this.xs.push(Math.max(-INK_COORD_LIMIT, Math.min(INK_COORD_LIMIT, Math.round(x))));
    this.ys.push(Math.max(-INK_COORD_LIMIT, Math.min(INK_COORD_LIMIT, Math.round(y))));
    this.ps.push(pressureByte(pressure));
    if (c === 0) this.kept.push(0);
    else if (this.kept.length < this.maxPoints - 1) this.advance(c);
  }

  /** The stroke so far: every kept point, then the pen's latest sample. */
  packed(): PackedInkStroke {
    const n = this.xs.length;
    const indices = n > 1 ? [...this.kept, n - 1] : [...this.kept];
    return {
      points: indices.flatMap((i) => [this.xs[i]!, this.ys[i]!]),
      pressures: indices.map((i) => this.ps[i]!),
    };
  }

  private advance(c: number): void {
    const a = this.kept[this.kept.length - 1]!;
    // The last three kept points: the span behind the pen and its tangent.
    const tail = this.kept.slice(-3);
    const first = Math.max(0, tail.length - 2);
    if (this.firstMiss([...tail, c], first).span < 0) return;

    // Keep the sample whose spans fit best. Scanning back from the pen, the
    // span to the pen only grows, so the first one that misses ends the scan.
    let best = -1;
    let bestError = Infinity;
    for (let j = c - 1; j > a; j -= 1) {
      const ids = [...tail, j, c];
      if (this.worstIn(ids, ids.length - 2).at >= 0) break;
      const fit = this.firstMiss(ids, first);
      if (fit.span < 0 && fit.error < bestError) {
        best = j;
        bestError = fit.error;
      }
    }
    if (best >= 0) {
      this.kept.push(best);
      return;
    }

    // No single sample fits, which happens at a sharp corner. Split at the
    // worst sample until every span fits. When the span behind the pen is the
    // one off, the corner point's tangent is to blame: keeping the sample
    // just past it makes the next chord short, so the tangent follows the
    // edge it closes and the corner stays sharp.
    const ids = [...tail, c];
    for (;;) {
      const miss = this.firstMiss(ids, first);
      if (miss.span < 0) break;
      if (miss.at < a) {
        const next = a + 1;
        if (next >= c || ids.includes(next)) break;
        ids.splice(ids.indexOf(a) + 1, 0, next);
      } else {
        ids.splice(miss.span + 1, 0, miss.at);
      }
    }
    const room = this.maxPoints - 1 - this.kept.length;
    this.kept.push(...ids.slice(tail.length, -1).slice(0, room));
  }

  /** The first span from `first` on with a sample out of tolerance, and the worst error of those that fit. */
  private firstMiss(ids: readonly number[], first: number): { span: number; at: number; error: number } {
    let error = 0;
    for (let s = first; s + 1 < ids.length; s += 1) {
      const worst = this.worstIn(ids, s);
      if (worst.at >= 0) return { span: s, at: worst.at, error };
      error = Math.max(error, worst.distance);
    }
    return { span: -1, at: -1, error };
  }

  /**
   * Span `s` of the curve through the samples `ids`: the sample inside it
   * farthest off the curve when that is past the tolerance (else the one
   * whose pressure leaves the ramp most), and the farthest squared distance.
   */
  private worstIn(ids: readonly number[], s: number): { at: number; distance: number } {
    const from = ids[s]!;
    const to = ids[s + 1]!;
    if (to - from < 2) return { at: -1, distance: 0 };
    const xs = ids.map((i) => this.xs[i]!);
    const ys = ids.map((i) => this.ys[i]!);
    const { curveX, curveY } = this;
    for (let k = 0; k <= PACK_SPAN_STEPS; k += 1) {
      const p = inkCurveAt(xs, ys, s, k / PACK_SPAN_STEPS);
      curveX[k] = p.x;
      curveY[k] = p.y;
    }
    const limit = this.tolerance * this.tolerance;
    let at = -1;
    let distance = 0;
    for (let j = from + 1; j < to; j += 1) {
      const px = this.xs[j]!;
      const py = this.ys[j]!;
      let best = Infinity;
      for (let k = 0; k < PACK_SPAN_STEPS; k += 1) {
        const ax = curveX[k]!;
        const ay = curveY[k]!;
        const vx = curveX[k + 1]! - ax;
        const vy = curveY[k + 1]! - ay;
        const length = vx * vx + vy * vy;
        const u = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length)) : 0;
        const dx = ax + u * vx - px;
        const dy = ay + u * vy - py;
        best = Math.min(best, dx * dx + dy * dy);
      }
      if (best > distance) {
        if (best > limit) at = j;
        distance = best;
      }
    }
    if (at >= 0) return { at, distance };
    let far = this.pressureTolerance;
    for (let j = from + 1; j < to; j += 1) {
      const t = (j - from) / (to - from);
      const off = Math.abs(this.ps[j]! - (this.ps[from]! + (this.ps[to]! - this.ps[from]!) * t));
      if (off > far) {
        far = off;
        at = j;
      }
    }
    return { at, distance };
  }
}
