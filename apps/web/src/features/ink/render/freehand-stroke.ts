/**
 * The `freehand` renderer, behind the `inkRenderer` setting. Its outline is
 * Excalidraw's freedraw path, copied verbatim in `excalidraw-freedraw.ts` (MIT;
 * perfect-freehand does the stroke maths). `classic` keeps the capsule renderer.
 *
 * Units: points and the returned path are in the stroke's own units (0.1 mm on
 * paper, px on the canvas).
 */

import { freedrawPath, type FreedrawShape } from "./excalidraw-freedraw";

export const INK_RENDERERS = ["classic", "freehand"] as const;
export type InkRendererKind = (typeof INK_RENDERERS)[number];
export const DEFAULT_INK_RENDERER: InkRendererKind = "classic";

/** The settled stroke's path (SVG `d`) from flat `x, y` pairs, as Excalidraw draws it. */
export function freehandPathFromFlat(
  points: readonly number[],
  width: number,
  pressures?: ArrayLike<number>,
  shape?: FreedrawShape,
): string {
  const count = points.length >> 1;
  const x = new Array<number>(count);
  const y = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    x[i] = points[2 * i]!;
    y[i] = points[2 * i + 1]!;
  }
  return freedrawPath(x, y, width, true, pressures, shape);
}

/**
 * Excalidraw's path data as the parts a canvas painter replays: the opening
 * point, one quadratic curve per `Q` (`[control x, control y, end x, end y]`),
 * then the closing line and close. Null for an empty or unreadable path. The
 * wet painter draws these, so it traces the same geometry as the settled SVG.
 */
export function freedrawCurves(d: string): {
  start: [number, number];
  curves: [number, number, number, number][];
} | null {
  const tokens = d.match(/[MQLZ]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  if (!tokens || tokens[0] !== "M") return null;
  const start: [number, number] = [Number(tokens[1]), Number(tokens[2])];
  const curves: [number, number, number, number][] = [];
  let command = "";
  for (let i = 3; i < tokens.length; ) {
    const token = tokens[i]!;
    if (token === "Q" || token === "L" || token === "Z") {
      command = token;
      i += 1;
    } else if (command === "Q") {
      curves.push([Number(tokens[i]), Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3])]);
      i += 4;
    } else {
      i += 1;
    }
  }
  return { start, curves };
}

export type FreehandCurves = NonNullable<ReturnType<typeof freedrawCurves>>;

interface OutlineEntry {
  count: number;
  width: number;
  last: boolean;
  shape: FreedrawShape | undefined;
  curves: FreehandCurves | null;
}

/**
 * Settled freehand outlines, so a repaint replays cached curves instead of
 * building the path and parsing it again. An entry is keyed by the stroke's id
 * and reused while the point count, width, `last` and shape (by identity) match. Two entries per id:
 * the stroke and its selection halo (whose width changes with zoom).
 *
 * The key does not see points edited in place (a moved selection keeps its
 * count), so the owner calls `forget` whenever a stroke's points change.
 */
export class FreehandOutlineCache {
  private readonly entries = new Map<number, OutlineEntry[]>();

  outline(
    id: number,
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    pressure: ArrayLike<number>,
    width: number,
    last: boolean,
    shape?: FreedrawShape,
  ): FreehandCurves | null {
    const count = x.length;
    const list = this.entries.get(id) ?? [];
    const at = list.findIndex((e) => e.count === count && e.width === width && e.last === last && e.shape === shape);
    if (at >= 0) {
      const hit = list[at]!;
      if (at > 0) list.unshift(...list.splice(at, 1));
      return hit.curves;
    }
    const curves = freedrawCurves(freedrawPath(x, y, width, last, pressure, shape));
    list.unshift({ count, width, last, shape, curves });
    list.length = Math.min(list.length, 2);
    this.entries.set(id, list);
    return curves;
  }

  forget(id: number): void {
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * The setting's value from storage or a form. Anything but `"freehand"` is
 * `classic`, so a stale or mistyped value never switches the renderer.
 */
export function parseInkRenderer(raw: unknown): InkRendererKind {
  return raw === "freehand" ? "freehand" : DEFAULT_INK_RENDERER;
}

/**
 * The dev flag that shows the A/B renderer buttons on the canvas. Only the
 * literal `"on"` shows them, so an unset or stale value keeps the UI as it is.
 */
export function parseInkABOn(raw: unknown): boolean {
  return raw === "on";
}
