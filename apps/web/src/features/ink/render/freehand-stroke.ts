/**
 * The `freehand` renderer, behind the `inkRenderer` setting. Its outline is
 * Excalidraw's freedraw path, copied verbatim in `excalidraw-freedraw.ts` (MIT;
 * perfect-freehand does the stroke maths). `classic` keeps the capsule renderer.
 *
 * Units: points and the returned path are in the stroke's own units (0.1 mm on
 * paper, px on the canvas).
 */

import { freedrawPath } from "./excalidraw-freedraw";

export const INK_RENDERERS = ["classic", "freehand"] as const;
export type InkRendererKind = (typeof INK_RENDERERS)[number];
export const DEFAULT_INK_RENDERER: InkRendererKind = "classic";

/** The settled stroke's path (SVG `d`) from flat `x, y` pairs, as Excalidraw draws it. */
export function freehandPathFromFlat(points: readonly number[], width: number): string {
  const count = points.length >> 1;
  const x = new Array<number>(count);
  const y = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    x[i] = points[2 * i]!;
    y[i] = points[2 * i + 1]!;
  }
  return freedrawPath(x, y, width, true);
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

/**
 * The setting's value from storage or a form. Anything but `"freehand"` is
 * `classic`, so a stale or mistyped value never switches the renderer.
 */
export function parseInkRenderer(raw: unknown): InkRendererKind {
  return raw === "freehand" ? "freehand" : DEFAULT_INK_RENDERER;
}
