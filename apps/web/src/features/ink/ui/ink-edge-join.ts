export interface EdgePoint {
  x: number;
  y: number;
}

/** Where a stroke split at a page break picks up again (§ink-page edge split).
 *  When pages abut, the point the pen left the old sheet is on the new sheet's
 *  top or bottom edge, and the new stroke must start there — not at the pen's
 *  first sample inside the new page — or the piece between is never drawn. */
export function joinPoint(
  exitAt: EdgePoint | null,
  box: { top: number; bottom: number },
  tolerance = 1.5,
): EdgePoint | null {
  if (!exitAt) return null;
  if (!Number.isFinite(exitAt.y)) return null;
  const onTop = Number.isFinite(box.top) && Math.abs(exitAt.y - box.top) <= tolerance;
  const onBottom = Number.isFinite(box.bottom) && Math.abs(exitAt.y - box.bottom) <= tolerance;
  return onTop || onBottom ? exitAt : null;
}
