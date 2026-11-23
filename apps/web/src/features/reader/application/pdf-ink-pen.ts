/**
 * The notes' pen on a PDF page: the coordinates between them.
 *
 * The pen and its worker think in page units (0.1 mm), as on a sheet of Notes;
 * the reader stores PDF points. The pen's page is the page box as laid out on
 * screen, so its units are CSS px over the zoom times {@link PEN_UNITS_PER_PT},
 * and a committed stroke goes back through the reader's own
 * `screenPointToPdf`, which is what handles rotation.
 */

/** Page units (0.1 mm) per PDF point: 25.4 mm per inch over 72 pt. */
export const PEN_UNITS_PER_PT = 254 / 72;

export interface PenPageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A client point as pen page units, or null off the page box. */
export function clientToPenUnits(
  clientX: number,
  clientY: number,
  box: PenPageBox,
  scale: number,
): { x: number; y: number } | null {
  const x = clientX - box.left;
  const y = clientY - box.top;
  if (x < 0 || y < 0 || x > box.width || y > box.height) return null;
  return { x: (x / scale) * PEN_UNITS_PER_PT, y: (y / scale) * PEN_UNITS_PER_PT };
}

/** The worker's viewport scale: CSS px per page unit at the reader's zoom. */
export function penViewportScale(scale: number): number {
  return scale / PEN_UNITS_PER_PT;
}

/** A committed stroke's `x, y` pairs (page units) as a flat PDF path. */
export function penPointsToPdfPath(
  points: ArrayLike<number>,
  scale: number,
  toPdf: (cssX: number, cssY: number) => { x: number; y: number },
): number[] {
  const path: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const at = toPdf((points[i]! / PEN_UNITS_PER_PT) * scale, (points[i + 1]! / PEN_UNITS_PER_PT) * scale);
    path.push(at.x, at.y);
  }
  return path;
}
