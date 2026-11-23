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

/**
 * A client point as pen page units from the page box's corner, or null off
 * `area` (the page box itself unless given: the row with its margin strip).
 */
export function clientToPenUnits(
  clientX: number,
  clientY: number,
  box: PenPageBox,
  scale: number,
  area: PenPageBox = box,
): { x: number; y: number } | null {
  const ax = clientX - area.left;
  const ay = clientY - area.top;
  if (ax < 0 || ay < 0 || ax > area.width || ay > area.height) return null;
  const x = clientX - box.left;
  const y = clientY - box.top;
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

/** The pen sits on a page only for the two drawing tools; every other tool keeps the page's own pointer. */
export function pdfPenMounts(canCreate: boolean, hasSize: boolean, tool: string): boolean {
  return canCreate && hasSize && (tool === "ink" || tool === "highlighter");
}

/**
 * The pages that carry a pen: every page on screen, plus the current page and
 * its neighbours, so the first stroke on any visible page draws.
 */
export function pdfPenPages(ratios: ReadonlyMap<number, number>, current: number, numPages: number): Set<number> {
  const pages = new Set<number>();
  for (const [page, ratio] of ratios) if (ratio > 0) pages.add(page);
  for (const page of [current - 1, current, current + 1]) if (page >= 1 && page <= numPages) pages.add(page);
  return pages;
}

/**
 * When the pen's wet ink may be cleared: once every save has landed (the
 * annotation layer draws the mark from then on) and no stroke is in flight,
 * so a newer stroke keeps its preview and an unsaved one never vanishes.
 * A save that did not land holds the wet ink: it is the only copy of that
 * stroke on screen, as a note keeps an unsaved stroke and reports the save.
 */
export class WetInkClear {
  private pending = 0;
  private dirty = false;
  private held = false;

  constructor(
    private readonly clear: () => void,
    private readonly penDown: () => boolean,
  ) {}

  saving(): void {
    this.pending += 1;
    this.dirty = true;
  }

  saved(): void {
    this.pending -= 1;
    this.settle();
  }

  /** The save did not land: the wet ink stays for this pen's life. */
  failed(): void {
    this.pending -= 1;
    this.held = true;
  }

  settle(): void {
    if (this.pending === 0 && this.dirty && !this.held && !this.penDown()) {
      this.dirty = false;
      this.clear();
    }
  }
}