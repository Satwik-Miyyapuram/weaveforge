/*
 * Copied from Excalidraw (https://github.com/excalidraw/excalidraw), MIT License,
 * Copyright (c) 2020 Excalidraw.
 *   Tag:    v0.18.1
 *   Commit: a2ec2889babf7d2295469c6d90ebe77fae57df84
 *   File:   packages/excalidraw/renderer/renderElement.ts
 *           (getFreeDrawSvgPath, med, TO_FIXED_PRECISION, getSvgPathFromStroke)
 *
 * The options and the path function are Excalidraw's, unchanged. The only edits:
 * the element argument is a plain object of the fields the function reads, and
 * the types are kept in the signature, and index reads carry non-null assertions,
 * and an optional `overrides` argument replaces options (INK_FREEDRAW, below).
 *
 * MIT License
 *
 * Copyright (c) 2020 Excalidraw
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { getStroke, type StrokeOptions } from "perfect-freehand";
import { smoothKeepingCorners } from "./corner-smoothing";

/** The fields of an Excalidraw freedraw element that the path function reads. */
export interface FreedrawElement {
  points: number[][];
  pressures: number[];
  strokeWidth: number;
  simulatePressure: boolean;
  lastCommittedPoint: unknown;
}

export function getFreeDrawSvgPath(element: FreedrawElement, overrides?: Partial<StrokeOptions>) {
  const inputPoints = element.simulatePressure
    ? element.points
    : element.points.length
    ? element.points.map(([x, y], i) => [x, y, element.pressures[i]])
    : [[0, 0, 0.5]];

  // Consider changing the options for simulated pressure vs real pressure
  const options: StrokeOptions = {
    simulatePressure: element.simulatePressure,
    size: element.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2), // https://easings.net/#easeOutSine
    last: !!element.lastCommittedPoint, // LastCommittedPoint is added on pointerup
    ...overrides,
  };

  return getSvgPathFromStroke(getStroke(inputPoints as number[][], options));
}

function med(A: number[], B: number[]) {
  return [(A[0]! + B[0]!) / 2, (A[1]! + B[1]!) / 2];
}

// Trim SVG path data so number are each two decimal points. This
// improves SVG exports, and prevents rendering errors on points
// with long decimals.
const TO_FIXED_PRECISION = /(\s?[A-Z]?,?-?[0-9]*\.[0-9]{0,2})(([0-9]|e|-)*)/g;

function getSvgPathFromStroke(points: number[][]): string {
  if (!points.length) {
    return "";
  }

  const max = points.length - 1;

  return points
    .reduce(
      (acc, point, i, arr) => {
        if (i === max) {
          acc.push(point, med(point, arr[0]!), "L", arr[0], "Z");
        } else {
          acc.push(point, med(point, arr[i + 1]!));
        }
        return acc;
      },
      ["M", points[0], "Q"],
    )
    .join(" ")
    .replace(TO_FIXED_PRECISION, "$1");
}

/**
 * Our ink's freedraw options, the one place they are tuned. The target is
 * OneNote's pen, measured by replaying one SendInput stroke file into OneNote
 * and into the app: its body is about 1.32 times the nominal width at every
 * speed and sample spacing (Pen 0.25 mm drew 2.5 device px for 1.89 nominal).
 *
 * Mouse (simulated pressure): Excalidraw's thinning 0.6 made the width depend
 * on sample spacing relative to size, so a thin pen at pointer speed saturated
 * to half its width. Thinning 0 draws a constant width equal to `size`.
 * Real pen: Excalidraw's thinning 0.6, so pressure still sets the width; at
 * pressure 0.5 the radius is size * sin(pi / 4), so the size is scaled down by
 * sqrt 2 to draw the mouse's width at mid pressure.
 */
export const INK_FREEDRAW = {
  /** OneNote's drawn body width over the nominal pen width. */
  widthRatio: 1.35,
  mouse: { thinning: 0, smoothing: 0.5, streamline: 0.15 },
  pen: { thinning: 0.6, smoothing: 0.5, streamline: 0.15 },
} as const;

/**
 * The stroke-shape knobs of the ink tuning (`ink.tuning` in the workspace
 * settings), freehand renderer only. At the defaults the outline is exactly
 * INK_FREEDRAW's pen. `thinning` applies to a real pen only (the mouse keeps a
 * constant width); `pressureGamma` and `minWidth` reshape the pen's pressure as
 * `max(minWidth, p) ** pressureGamma`; the tapers are perfect-freehand's, in
 * the stroke's own units, 0 for none.
 */
export interface FreedrawShape {
  thinning: number;
  smoothing: number;
  streamline: number;
  taperStart: number;
  taperEnd: number;
  pressureGamma: number;
  minWidth: number;
}

export const DEFAULT_FREEDRAW_SHAPE: Readonly<FreedrawShape> = Object.freeze({
  thinning: INK_FREEDRAW.pen.thinning,
  smoothing: INK_FREEDRAW.pen.smoothing,
  streamline: INK_FREEDRAW.pen.streamline,
  taperStart: 0,
  taperEnd: 0,
  pressureGamma: 1,
  minWidth: 0,
});

/** A cache key for a shape: equal keys draw equal outlines. */
export function freedrawShapeKey(shape: FreedrawShape = DEFAULT_FREEDRAW_SHAPE): string {
  return [
    shape.thinning, shape.smoothing, shape.streamline, shape.taperStart,
    shape.taperEnd, shape.pressureGamma, shape.minWidth,
  ].join(",");
}

/**
 * The freedraw outline of a stroke `width` units wide, with INK_FREEDRAW's options and `shape`'s knobs.
 * The points are smoothed first, corners kept (corner-smoothing.ts), so a low streamline
 * draws sharp corners without following every shake of the hand.
 */
export function inkFreedrawPath(
  points: number[][],
  pressures: number[],
  width: number,
  simulatePressure: boolean,
  last: boolean,
  shape: FreedrawShape = DEFAULT_FREEDRAW_SHAPE,
): string {
  const drawn = Math.max(0, width) * INK_FREEDRAW.widthRatio;
  const options: Partial<StrokeOptions> = {
    thinning: simulatePressure ? INK_FREEDRAW.mouse.thinning : shape.thinning,
    smoothing: shape.smoothing,
    streamline: shape.streamline,
    size: simulatePressure ? drawn : drawn / Math.SQRT2,
  };
  if (shape.taperStart > 0 || shape.taperEnd > 0) {
    options.start = { taper: shape.taperStart };
    options.end = { taper: shape.taperEnd };
  }
  const reshaped =
    simulatePressure || (shape.pressureGamma === 1 && shape.minWidth === 0)
      ? pressures
      : pressures.map((p) => Math.max(shape.minWidth, p) ** shape.pressureGamma);
  return getFreeDrawSvgPath(
    { points: smoothKeepingCorners(points), pressures: reshaped, strokeWidth: 0, simulatePressure, lastCommittedPoint: last ? [0, 0] : null },
    options,
  );
}

/**
 * True when a stroke's pressures carry no pen data: none at all, or every one
 * at the midpoint (to within one byte), which is what a mouse or touch sends.
 * Decided from the whole stroke, so a pen whose first sample happens to be at
 * 0.5 still draws with its pressure.
 */
export function isSimulatedPressure(pressures: ArrayLike<number>): boolean {
  for (let i = 0; i < pressures.length; i++) {
    if (Math.abs(pressures[i]! - 0.5) > 1 / 255) return false;
  }
  return true;
}

/**
 * A stroke from flat `x`, `y` arrays, for paper ink. `pressure` is the stored
 * byte per point (0-255). A pen stroke draws with it; with no pressure, or one
 * of the wrong length, every point is at the midpoint and the mouse options
 * apply. `last` is the same for the wet and the settled stroke.
 */
export function freedrawPath(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  width: number,
  last: boolean,
  pressure?: ArrayLike<number>,
  shape?: FreedrawShape,
): string {
  const count = Math.min(x.length, y.length);
  const real = pressure !== undefined && pressure.length === count;
  const points: number[][] = [];
  const pressures: number[] = [];
  for (let i = 0; i < count; i++) {
    points.push([x[i]!, y[i]!]);
    pressures.push(real ? pressure[i]! / 255 : 0.5);
  }
  return inkFreedrawPath(points, pressures, width, isSimulatedPressure(pressures), last, shape);
}
