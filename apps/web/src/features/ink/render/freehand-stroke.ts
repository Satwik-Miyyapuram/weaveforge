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
 */

import { getStroke, type StrokeOptions } from "perfect-freehand";

export const INK_RENDERERS = ["classic", "freehand"] as const;
export type InkRendererKind = (typeof INK_RENDERERS)[number];
export const DEFAULT_INK_RENDERER: InkRendererKind = "classic";

/** The easing tldraw uses for pen strokes: 65 % linear, 35 % sine. */
export const PEN_EASING = (t: number): number =>
  0.65 * t + 0.35 * Math.sin((t * Math.PI) / 2);

/**
 * The tldraw "draw" pen. `size` is `1 + width * 1.2` in tldraw's own terms; the
 * `width` argument here is our stroke width (0.1 mm).
 */
export function tldrawPenOptions(
  width: number,
  last: boolean,
  simulatePressure: boolean,
): StrokeOptions {
  return {
    size: 1 + width * 1.2,
    thinning: 0.62,
    streamline: 0.62,
    smoothing: 0.62,
    simulatePressure,
    easing: PEN_EASING,
    last,
  };
}

/**
 * Excalidraw's freedraw, kept as a named reference only. Nothing wires it.
 * `size = strokeWidth * 4.25`, streamline is per element (0.5 here, the
 * library default), and `t => sin(t * PI / 2)` easing.
 */
export function excalidrawFreedrawOptions(
  width: number,
  last: boolean,
): StrokeOptions {
  return {
    size: width * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    easing: (t: number) => Math.sin((t * Math.PI) / 2),
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
  options: { last: boolean; simulatePressure: boolean },
): FreehandOutline {
  const count = Math.min(points.x.length, points.y.length, points.pressure.length);
  if (count === 0) return [];
  const input: [number, number, number][] = new Array(count);
  for (let i = 0; i < count; i++) {
    input[i] = [points.x[i]!, points.y[i]!, points.pressure[i]! / 255];
  }
  const outline = getStroke(input, tldrawPenOptions(width, options.last, options.simulatePressure));
  return outline as unknown as FreehandOutline;
}

/** The outline as SVG path data (`M … L … Z`), for `new Path2D(d)` and SVG `d`. */
export function outlinePathData(outline: FreehandOutline): string {
  if (outline.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i]!;
    parts.push(`${i === 0 ? "M" : "L"}${x} ${y}`);
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
