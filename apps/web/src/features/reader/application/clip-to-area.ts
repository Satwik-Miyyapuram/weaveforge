/**
 * The box a stroke may be drawn in, and what to do when the pen leaves it.
 *
 * A hand does not stop at the edge of the paper. It runs off the page, into the
 * gap between two pages or over the toolbar, and comes back — and a stroke that
 * simply kept collecting points through all of that would come back with a
 * straight line drawn across everything it passed over, in a place the page
 * does not own. So a stroke is **cut at the edge it crosses**, and the part
 * drawn after the pen returns is a **new stroke**, starting where the pen
 * crossed back in. The printer's rule: the ink that lands on the sheet is on the
 * sheet, and the pen's travel outside it leaves no mark.
 *
 * The area is in client pixels, not page units: it is the element the pointer
 * handlers live on, which already accounts for zoom, rotation and the writing
 * margin beside the page.
 */

/** A box in client pixels. */
export interface DrawArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Whether a point is inside the area, edges included. */
export function pointInArea(area: DrawArea, x: number, y: number): boolean {
  return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
}

/**
 * The part of a segment that is inside the area, or `null` for none of it.
 *
 * The Liang–Barsky slab test, which is the standard way to do this without
 * branching per edge: each edge narrows the parameter range `[t0, t1]` within
 * which the segment is inside, and the two remaining parameters are the points
 * where it crossed in and out. A segment that starts inside and ends outside
 * therefore comes back with `to` on the boundary — the cut — and one that starts
 * outside and ends inside comes back with `from` on the boundary, which is where
 * the new stroke begins.
 */
export function clipSegmentToArea(
  area: DrawArea,
  from: Point,
  to: Point,
): { from: Point; to: Point } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;

  const edges: [number, number][] = [
    [-dx, from.x - area.left],
    [dx, area.right - from.x],
    [-dy, from.y - area.top],
    [dy, area.bottom - from.y],
  ];

  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: either wholly inside that slab, or wholly out.
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return {
    from: { x: from.x + dx * t0, y: from.y + dy * t0 },
    to: { x: from.x + dx * t1, y: from.y + dy * t1 },
  };
}
