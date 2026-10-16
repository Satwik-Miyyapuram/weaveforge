import { shouldAppendInkPoint } from "@weaveforge/core";
import { NibFilter } from "@/features/ink";

/** 0.1 mm per PDF point: the notes' filter is tuned in tenths of a millimetre. */
const TENTHS_PER_PT = (25.4 / 72) * 10;

/** Smallest gap kept between PDF ink samples, in points (~0.09 mm). */
export const PDF_INK_MIN_POINT_DISTANCE = 0.25;

/** RDP tolerance when a PDF stroke is saved, in points: sub-pixel, so the stroke keeps its shape. */
export const PDF_INK_SAVE_TOLERANCE = 0.1;

/**
 * The notes' pen pipeline for a PDF stroke: every sample (coalesced ones too)
 * through the same One Euro filter, so a paper and a note ink alike.
 */
export class PdfInkSampler {
  private readonly filter = new NibFilter();
  readonly path: number[] = [];

  /** Start a stroke at a PDF point. */
  begin(x: number, y: number, t: number): void {
    this.filter.reset();
    this.path.length = 0;
    this.push(x, y, t);
  }

  /** Filter one PDF-space sample; returns whether the path grew. */
  push(x: number, y: number, t: number): boolean {
    const at = Number.isFinite(t) ? t : performance.now();
    const out = this.filter.filter({ x: x * TENTHS_PER_PT, y: y * TENTHS_PER_PT, pressure: 0, t: at });
    const fx = out.x / TENTHS_PER_PT;
    const fy = out.y / TENTHS_PER_PT;
    if (!shouldAppendInkPoint(this.path, fx, fy, PDF_INK_MIN_POINT_DISTANCE)) return false;
    this.path.push(fx, fy);
    return true;
  }

  /** Append an exact point (the page-edge cut), unfiltered. */
  pushExact(x: number, y: number): void {
    if (shouldAppendInkPoint(this.path, x, y, PDF_INK_MIN_POINT_DISTANCE)) this.path.push(x, y);
  }

  clear(): void {
    this.path.length = 0;
  }
}

/** The samples a pointermove carries: its coalesced events, or itself. */
export function coalescedSamples(event: PointerEvent): PointerEvent[] {
  try {
    const list = event.getCoalescedEvents?.();
    if (list && list.length > 0) return list;
  } catch {
    // Some hosts throw on untrusted events.
  }
  return [event];
}
