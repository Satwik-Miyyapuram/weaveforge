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
 * the types are kept in the signature, and index reads carry non-null assertions.
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

/** The fields of an Excalidraw freedraw element that the path function reads. */
export interface FreedrawElement {
  points: number[][];
  pressures: number[];
  strokeWidth: number;
  simulatePressure: boolean;
  lastCommittedPoint: unknown;
}

export function getFreeDrawSvgPath(element: FreedrawElement) {
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
 * The Excalidraw strokeWidth that draws a stroke `width` units wide.
 *
 * Excalidraw's strokeWidth is a style step (thin 1, bold 2, extra bold 4), not
 * a width: perfect-freehand gets size = strokeWidth * 4.25, and with simulated
 * pressure the drawn width also depends on how far apart the samples are
 * relative to that size. Passing our pen width straight in drew strokes 4 to 8
 * times too wide, which fused the legs of a fast zig-zag into blobs.
 *
 * This solves for the size at which a slow line, sampled 1 unit apart, is
 * `width` wide: there the simulated pressure settles at 1 - 1/size (0 once
 * size <= 1) and perfect-freehand's radius is
 * size * easeOutSine(0.5 - thinning * (0.5 - pressure)). Faster strokes still
 * thin out, as in Excalidraw (thinning 0.6). Canvas (px) and paper (0.1 mm)
 * both use it, each in its own unit.
 */
export function excalidrawStrokeWidth(width: number): number {
  if (!(width > 0)) return 0;
  const drawn = (size: number) => {
    const pressure = size > 1 ? 1 - 1 / size : 0;
    return 2 * size * Math.sin(((0.5 - 0.6 * (0.5 - pressure)) * Math.PI) / 2);
  };
  // drawn() grows with size, and size = 2 * width already draws wider than width.
  let lo = 0;
  let hi = 2 * width;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (drawn(mid) < width) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2 / 4.25;
}

/**
 * A stroke from flat `x`, `y` arrays, for paper ink. Settled strokes carry no
 * pressure, so every point is at the midpoint and Excalidraw's simulated
 * pressure applies. `last` is the same for the wet and the settled stroke.
 */
export function freedrawPath(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  width: number,
  last: boolean,
): string {
  const count = Math.min(x.length, y.length);
  const points: number[][] = [];
  const pressures: number[] = [];
  for (let i = 0; i < count; i++) {
    points.push([x[i]!, y[i]!]);
    pressures.push(0.5);
  }
  return getFreeDrawSvgPath({
    points,
    pressures,
    strokeWidth: excalidrawStrokeWidth(width),
    simulatePressure: true,
    lastCommittedPoint: last ? [0, 0] : null,
  });
}
