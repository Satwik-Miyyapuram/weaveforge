import assert from "node:assert/strict";
import { test } from "node:test";

import { paintFreehandStroke, type Context2dLike } from "../render/canvas-renderer";
import { readyCore } from "@/lib/rust-core";
import { settledStrokePath } from "../ui/ink-strokes";
import { freedrawPath } from "../render/excalidraw-freedraw";

const POINTS = [0, 0, 50, 0, 100, 20];
const WIDTH = 10;

test("the settled stroke is the capsule path when the renderer is classic", () => {
  assert.equal(settledStrokePath(POINTS, WIDTH, "classic"), readyCore().strokePath(POINTS));
});

test("the settled stroke is a perfect-freehand outline when the renderer is freehand", () => {
  const d = settledStrokePath(POINTS, WIDTH, "freehand") ?? "";
  assert.match(d, /^M/);
  assert.ok(d.endsWith(" Z"));
  assert.notEqual(d, readyCore().strokePath(POINTS));
});

test("a settled freehand stroke is Excalidraw's freedraw path for its points", () => {
  assert.equal(
    settledStrokePath(POINTS, WIDTH, "freehand"),
    freedrawPath([0, 50, 100], [0, 0, 20], WIDTH, true),
  );
});

/** Points along outline path data: each quadratic sampled at eight steps, plus every end point. */
function outlinePoints(d: string): [number, number][] {
  const tokens = d.match(/[MLQZ]|-?[\d.]+(?:e-?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  let command = "";
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i]!;
    if (/^[MLQZ]$/.test(token)) {
      command = token;
      i += 1;
    } else if (command === "Q") {
      const num = (k: number): number => Number(tokens[i + k]);
      const px = num(0);
      const py = num(1);
      const ex = num(2);
      const ey = num(3);
      for (let s = 1; s <= 8; s += 1) {
        const u = s / 8;
        const v = 1 - u;
        points.push([v * v * cx + 2 * v * u * px + u * u * ex, v * v * cy + 2 * v * u * py + u * u * ey]);
      }
      cx = ex;
      cy = ey;
      i += 4;
    } else if (command === "M" || command === "L") {
      cx = Number(tokens[i]);
      cy = Number(tokens[i + 1]);
      points.push([cx, cy]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return points;
}

/** Largest distance from any point of one outline to the nearest point of the other, both ways. */
function worstGap(a: readonly [number, number][], b: readonly [number, number][]): number {
  const far = (from: readonly [number, number][], to: readonly [number, number][]) =>
    from.reduce(
      (worst, [x, y]) =>
        Math.max(worst, to.reduce((best, [u, v]) => Math.min(best, Math.hypot(x - u, y - v)), Infinity)),
      0,
    );
  return Math.max(far(a, b), far(b, a));
}

test("the wet stroke paints the settled SVG outline: painted geometry within 0.001 units", () => {
  const calls: string[] = [];
  const context = {
    fillStyle: "",
    beginPath() {},
    moveTo(x: number, y: number) {
      calls.push(`M${x} ${y}`);
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      calls.push(`Q${cx} ${cy} ${x} ${y}`);
    },
    lineTo(x: number, y: number) {
      calls.push(`L${x} ${y}`);
    },
    closePath() {},
    fill() {},
    arc() {},
  };
  const x = Float32Array.from([0, 50, 100]);
  const y = Float32Array.from([0, 0, 20]);
  paintFreehandStroke(
    context as unknown as Context2dLike,
    x,
    y,
    new Uint8Array([255, 255, 255]),
    { width: WIDTH, tool: "pen", colour: "text" },
    false,
  );
  const wet = outlinePoints(calls.join(" "));
  const settled = outlinePoints(settledStrokePath(POINTS, WIDTH, "freehand") ?? "");
  assert.ok(wet.length > 0 && settled.length > 0);
  const gap = worstGap(wet, settled);
  assert.ok(gap <= 1e-3, `painted outline is ${gap} units from the settled SVG outline`);
});

test("the comparison fails when one outline point moves 0.5 units", () => {
  // Guards the comparison itself: a single point off the outline must exceed the tolerance.
  const settled = outlinePoints(settledStrokePath(POINTS, WIDTH, "freehand") ?? "");
  const moved = settled.map((p, i): [number, number] => (i === 0 ? [p[0] + 0.5, p[1]] : p));
  assert.ok(worstGap(moved, settled) > 1e-3);
});
