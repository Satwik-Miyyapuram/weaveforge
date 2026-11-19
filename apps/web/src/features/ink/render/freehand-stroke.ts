/**
 * The perfect-freehand outline of a stroke, behind the `inkRenderer` setting.
 *
 * `classic` keeps the capsule renderer. `freehand` fills the outline that
 * perfect-freehand (MIT; used by tldraw and Excalidraw) draws around the same
 * points. The presets are the library settings tldraw and Excalidraw ship with,
 * copied as they are, with no tuning of our own.
 *
 * Units: points and the returned outline are in the stroke's own units (0.1 mm).
 * Pressure goes in as 0–1; the stroke's pressure is 0–255.
 *
 * Pressure is held at the midpoint (`FREEHAND_PRESSURE`) on both the wet and the
 * settled stroke. Settled strokes carry no pressure (the Rust render path drops
 * it), so a stroke that used live pressure would change width on release. At the
 * midpoint the width is the nib's width for both, and the classic capsule's.
 */

import { getStroke, type StrokeOptions } from "perfect-freehand";

export const INK_RENDERERS = ["classic", "freehand"] as const;
export type InkRendererKind = (typeof INK_RENDERERS)[number];
export const DEFAULT_INK_RENDERER: InkRendererKind = "classic";

/** The easing tldraw uses for pen strokes: 65 % linear, 35 % sine. */
export const PEN_EASING = (t: number): number =>
  0.65 * t + 0.35 * Math.sin((t * Math.PI) / 2);

/** Midpoint pressure, on the 0–255 stored scale (0.5 after `freehandOutline`). */
export const FREEHAND_PRESSURE = 127.5;

/**
 * The tldraw "draw" pen. Perfect-freehand's radius at pressure p is
 * `size * easing(0.5 - thinning * (0.5 - p))`, so for the pen `size` is scaled
 * to give a radius of `width / 2` at the midpoint pressure, the classic capsule's
 * diameter. A highlighter has `thinning: 0`, and the library then takes its
 * radius as `size / 2` with no easing, so its `size` is the width itself.
 */
export function tldrawPenOptions(
  width: number,
  last: boolean,
  simulatePressure: boolean,
  highlighter = false,
): StrokeOptions {
  return {
    size: highlighter ? width : width / (2 * PEN_EASING(0.5)),
    thinning: highlighter ? 0 : 0.62,
    streamline: 0.5,
    smoothing: 0.5,
    simulatePressure,
    easing: PEN_EASING,
    last,
  };
}

/** The parallel point arrays a stroke carries. */
export interface FreehandPoints {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** 0–255, as stored. */
  pressure: ArrayLike<number>;
}

/** The outline polygon, closed by the caller (its last point is not the first). */
export type FreehandOutline = readonly (readonly [number, number])[];

/**
 * The outline of one stroke. The points go to perfect-freehand raw: no filter
 * or simplification of ours runs first. A stroke with no points has no outline.
 */
export function freehandOutline(
  points: FreehandPoints,
  width: number,
  options: { last: boolean; simulatePressure: boolean; highlighter?: boolean },
): FreehandOutline {
  const count = Math.min(points.x.length, points.y.length, points.pressure.length);
  if (count === 0) return [];
  const input: [number, number, number][] = new Array(count);
  for (let i = 0; i < count; i++) {
    input[i] = [points.x[i]!, points.y[i]!, points.pressure[i]! / 255];
  }
  const outline = getStroke(
    input,
    tldrawPenOptions(width, options.last, options.simulatePressure, options.highlighter),
  );
  return outline as unknown as FreehandOutline;
}

/**
 * The outline of a settled stroke, as SVG path data, from flat `x, y` pairs (the
 * shape `InkRenderStroke.points` carries). Every point is at the midpoint
 * pressure, the same as the wet stroke (see the header).
 */
export function freehandPathFromFlat(
  points: readonly number[],
  width: number,
  highlighter = false,
): string {
  const count = points.length >> 1;
  const x = new Array<number>(count);
  const y = new Array<number>(count);
  const pressure = new Array<number>(count).fill(FREEHAND_PRESSURE);
  for (let i = 0; i < count; i++) {
    x[i] = points[2 * i]!;
    y[i] = points[2 * i + 1]!;
  }
  return outlinePathData(
    freehandOutline({ x, y, pressure }, width, { last: true, simulatePressure: false, highlighter }),
  );
}

/**
 * The outline as closed SVG path data, for `new Path2D(d)` and SVG `d`. Each
 * outline point is a quadratic control point and the curve runs through the
 * midpoints between neighbours (perfect-freehand's README recipe), so the edge
 * is smooth rather than a polygon of straight `L` segments.
 */
export function outlinePathData(outline: FreehandOutline): string {
  const n = outline.length;
  if (n === 0) return "";
  const mid = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const start = mid(outline[n - 1]!, outline[0]!);
  const parts: string[] = [`M${start[0]} ${start[1]}`];
  for (let i = 0; i < n; i++) {
    const p = outline[i]!;
    const m = mid(p, outline[(i + 1) % n]!);
    parts.push(`Q${p[0]} ${p[1]} ${m[0]} ${m[1]}`);
  }
  return `${parts.join(" ")} Z`;
}

/**
 * The setting's value from storage or a form. Anything but `"freehand"` is
 * `classic`, so a stale or mistyped value never switches the renderer.
 */
export function parseInkRenderer(raw: unknown): InkRendererKind {
  return raw === "freehand" ? "freehand" : DEFAULT_INK_RENDERER;
}
