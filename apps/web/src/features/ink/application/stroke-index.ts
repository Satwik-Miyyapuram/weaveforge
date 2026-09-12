/**
 * Which strokes are near a point: the R-tree, and the tombstones that let it stay
 * still while the eraser runs.
 *
 * §6.2.4 is the whole design and this file is its implementation. Two decisions
 * make it work, and both are reactions to a measured failure:
 *
 * 1. **A packed Hilbert R-tree, not a uniform grid.** A 10 mm grid on a dense page
 *    left **mean 785 / max 1 623 strokes per occupied cell** (§11.3.7) — it did not
 *    index anything. A grid has a cell size to mistune; an R-tree does not, and it
 *    holds a 2 cm highlighter stroke and a 1 mm dot in the same structure.
 * 2. **Tombstones, not removal.** `flatbush` is *static* — it has no update and no
 *    delete, only `finish()`. An eraser sweep delivers 120–240 events a second and
 *    can remove dozens of strokes, so rebuilding per removal would re-sort every
 *    bounding box and allocate fresh typed arrays each time, inside the worker,
 *    during the gesture. Instead the index is immutable for the length of the
 *    gesture, a parallel bitmask records what is dead, and the rebuild happens
 *    **once, at `pointerup`**.
 *
 * `flatbush` is a new dependency and a deliberate one: 3 kB, `ISC`, and the
 * alternative is a hand-written tree with the same bugs and no tests. The plan
 * says MIT; the package's own `package.json` says ISC, and either way it is
 * permissive.
 */

import Flatbush from "flatbush";

import {
  boundsContain,
  boundsIntersect,
  type InkBounds,
  type InkPageBuffer,
} from "./page-buffer";

/**
 * The eraser's radius, in 0.1 mm: 3 mm either side of the nib.
 *
 * The reader's `ERASER_RADIUS` is in PDF units and cannot be reused — the same
 * trap as the widths (§6.3), and the reason this constant is here rather than
 * imported.
 */
export const ERASER_RADIUS = 30;

/**
 * How many candidates a pick may return before the index is not doing its job.
 *
 * §6.2.4 asserts ≤ 50 on a 5 000-stroke page. This is a *budget*, not a limit:
 * the query returns what it finds and the test fails if the number is larger,
 * because a pick that returns a thousand strokes is one the eraser then has to
 * hit-test a thousand times per event.
 */
export const MAX_PICK_CANDIDATES = 50;

/** The current index, or `null` for a page with nothing in it. */
interface BuiltIndex {
  tree: Flatbush;
  /** Stroke index per leaf, because dead strokes still occupy leaves. */
  leaves: Uint32Array;
  /** How many live strokes it was built from, for a diagnostic. */
  live: number;
}

/**
 * An R-tree over the page's stroke bounds, with liveness kept beside it.
 *
 * The tree is rebuilt on {@link rebuild} and left alone otherwise. Every query
 * filters dead entries out, so an erase is visible immediately without touching
 * the tree — which is exactly what makes a 200-event sweep allocation-free.
 */
export class InkStrokeIndex {
  private built: BuiltIndex | null = null;
  /** Rebuilds performed. The allocation assertion counts this. */
  rebuilds = 0;
  /** Leaves the last query scanned, for a performance assertion. */
  lastVisited = 0;

  constructor(private readonly buffer: InkPageBuffer) {}

  /** Whether an index exists yet. A query on a stale one rebuilds first. */
  get ready(): boolean {
    return this.built !== null;
  }

  /** Leaves in the current index, dead strokes included. */
  get size(): number {
    return this.built?.leaves.length ?? 0;
  }

  /**
   * Rebuild for the whole page.
   *
   * The only place that allocates. Called at pointerup, after a page load, and
   * after a compaction — never from a pointermove.
   */
  rebuild(): void {
    const alive: number[] = [];
    const boxes: InkBounds[] = [];
    for (let index = 0; index < this.buffer.capacity; index += 1) {
      const stroke = this.buffer.stroke(index);
      if (!stroke) continue;
      if (stroke.x.length === 0) continue;
      alive.push(index);
      boxes.push(stroke.bounds);
    }
    if (alive.length === 0) {
      this.built = null;
      this.rebuilds += 1;
      return;
    }

    const tree = new Flatbush(alive.length);
    for (const box of boxes) tree.add(box[0], box[1], box[2], box[3]);
    tree.finish();
    this.built = { tree, leaves: Uint32Array.from(alive), live: alive.length };
    this.rebuilds += 1;
  }

  /** Rebuild only if there is nothing to query yet. */
  ensure(): void {
    if (!this.built) this.rebuild();
  }

  /** Discard the index, for a page that is being reloaded or compacted. */
  invalidate(): void {
    this.built = null;
  }

  /**
   * Strokes whose bounds are within `radius` of a point.
   *
   * The bounds are a *filter*, not an answer: the caller still has to hit-test the
   * path, because a stroke's box contains a lot of places the stroke is not. That
   * is the point of returning candidates rather than results.
   */
  nearPoint(x: number, y: number, radius = ERASER_RADIUS): number[] {
    return this.nearBox([x - radius, y - radius, x + radius, y + radius]);
  }

  /**
   * Strokes near a swept segment — what an eraser drag actually queries.
   *
   * A 240 Hz digitiser moves the nib several millimetres between events, so a
   * point query per event would leave un-erased gaps between consecutive positions.
   * The box around the *segment* is what makes one sweep continuous.
   */
  nearSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius = ERASER_RADIUS,
  ): number[] {
    return this.nearBox([
      Math.min(x0, x1) - radius,
      Math.min(y0, y1) - radius,
      Math.max(x0, x1) + radius,
      Math.max(y0, y1) + radius,
    ]);
  }

  /** Strokes whose bounds meet a box, dead ones skipped. */
  nearBox(box: InkBounds, slack = 0): number[] {
    const built = this.built;
    if (!built) return [];
    const found = built.tree.search(
      box[0] - slack,
      box[1] - slack,
      box[2] + slack,
      box[3] + slack,
    );
    this.lastVisited = found.length;
    const out: number[] = [];
    for (const leaf of found) {
      const index = built.leaves[leaf];
      if (index === undefined) continue;
      if (!this.buffer.isAlive(index)) continue;
      const stroke = this.buffer.stroke(index);
      if (!stroke) continue;
      // A leaf's box is the stroke's own box, so this is an exact test against
      // what the tree stored rather than a second approximation of it.
      if (!boundsIntersect(stroke.bounds, box, slack)) continue;
      out.push(index);
    }
    return out;
  }

  /** Strokes whose bounds contain a point, dead ones skipped. */
  containing(x: number, y: number, slack = 0): number[] {
    const built = this.built;
    if (!built) return [];
    const found = built.tree.search(x, y, x, y);
    this.lastVisited = found.length;
    const out: number[] = [];
    for (const leaf of found) {
      const index = built.leaves[leaf];
      if (index === undefined || !this.buffer.isAlive(index)) continue;
      const stroke = this.buffer.stroke(index);
      if (stroke && boundsContain(stroke.bounds, x, y, slack)) out.push(index);
    }
    return out;
  }
}
